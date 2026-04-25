import Listing from '../models/Listing.js';
import fs from 'fs';
import path from 'path';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { calculateListingLevel } from '../utils/levelCalculator.js';
import Analytics from '../models/Analytics.js';
import InteractionLog from '../models/InteractionLog.js';
import { createAuditLog } from '../utils/logger.js';
import { applyPromotionLogic, resetPPC } from '../utils/promotionHelper.js';
import slugify from 'slugify';
import { continentMapping } from '../constants/continentData.js';
import crypto from 'crypto';
import {
  buildVersionedCacheKey,
  getCache,
  invalidateListingCaches,
  parseCachedJson,
  setCache,
} from '../utils/cache.js';

const ensureListingFavoriteState = (listing) => {
  if (!Array.isArray(listing.favorites)) {
    listing.favorites = [];
  }

  if (!listing.promotion || typeof listing.promotion !== 'object') {
    listing.promotion = {};
  }

  if (!listing.promotion.boost || typeof listing.promotion.boost !== 'object') {
    listing.promotion.boost = {};
  }

  if (!listing.promotion.ppc || typeof listing.promotion.ppc !== 'object') {
    listing.promotion.ppc = {};
  }

  listing.promotion.level ??= 0;
  listing.promotion.boost.isActive ??= false;
  listing.promotion.boost.isPaused ??= false;
  listing.promotion.boost.amountPaid ??= 0;
  listing.promotion.boost.expiresAt ??= null;
  listing.promotion.ppc.isActive ??= false;
  listing.promotion.ppc.isPaused ??= false;
  listing.promotion.ppc.ppcBalance ??= 0;
  listing.promotion.ppc.costPerClick ??= 0.1;
  listing.promotion.ppc.amountPaid ??= 0;
  listing.promotion.ppc.totalClicks ??= 0;
  listing.promotion.ppc.executedClicks ??= 0;

  return listing;
};

export const handlePpcClick = async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceId } = req.body;
    const userId = req.user?._id;

    if (!deviceId) return res.status(400).json({ message: 'Security token (deviceId) missing.' });

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (!listing.promotion?.ppc?.isActive || listing.promotion.ppc.ppcBalance <= 0) {
      return res.status(200).json({ success: true, message: 'Organic click recorded.' });
    }

    if (listing.promotion.ppc.isPaused) {
      return res
        .status(200)
        .json({ success: true, message: 'Campaign paused, organic click recorded.' });
    }

    const alreadyClicked = await InteractionLog.findOne({
      listingId: id,
      type: 'ppc_click',
      $or: [{ deviceId: deviceId }, ...(userId ? [{ userId: userId }] : [])],
    });

    if (alreadyClicked) {
      return res.status(200).json({ message: 'Duplicate click ignored.' });
    }

    const cost = listing.promotion.ppc.costPerClick || 0.1;

    if (listing.promotion.ppc.ppcBalance >= cost) {
      listing.promotion.ppc.ppcBalance = Number(
        (listing.promotion.ppc.ppcBalance - cost).toFixed(4)
      );
      listing.promotion.ppc.executedClicks += 1;

      let isBudgetExhausted = false;

      if (listing.promotion.ppc.ppcBalance < cost) {
        resetPPC(listing);
        isBudgetExhausted = true;
      }

      applyPromotionLogic(listing);
      await listing.save();
      await invalidateListingCaches({
        id: listing._id,
        slug: listing.slug,
        creatorId: listing.creatorId,
      });

      await InteractionLog.create({
        listingId: id,
        userId: userId || null,
        deviceId: deviceId,
        type: 'ppc_click',
      });

      await createAuditLog({
        req,
        user: listing.creatorId,
        action: 'PPC_CLICK_DEDUCTION',
        targetType: 'Listing',
        targetId: id,
        details: {
          listingTitle: listing.title,
          costDeducted: `${cost} EUR`,
          remainingPpcBalance: `${listing.promotion.ppc.ppcBalance} EUR`,
          isBudgetExhausted,
          totalExecutedClicks: listing.promotion.ppc.executedClicks,
        },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await Analytics.findOneAndUpdate(
        { listingId: id, date: today },
        {
          $inc: { clicks: 1 },
          $setOnInsert: { creatorId: listing.creatorId?._id || listing.creatorId },
        },
        { upsert: true }
      );

      return res.status(200).json({
        success: true,
        balance: listing.promotion.ppc.ppcBalance,
        currentLevel: listing.promotion.level,
      });
    }

    return res.status(400).json({ message: 'Insufficient PPC balance.' });
  } catch (error) {
    console.error('PPC Click Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getCategoriesAndTags = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const cacheKey = await buildVersionedCacheKey('meta:categories_tags', `p${page}:l${limit}`);
    const cachedData = parseCachedJson(await getCache(cacheKey));

    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    const [categories, regions] = await Promise.all([
      Category.find().sort({ order: 1 }).lean(),
      mongoose.model('Listing').distinct('region', { status: 'approved' }),
    ]);

    const skip = (page - 1) * limit;

    const tagsWithCount = await Tag.aggregate([
      { $sort: { title: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'listings',
          localField: '_id',
          foreignField: 'culturalTags',
          as: 'matchedListings',
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          image: 1,
          listingCount: {
            $size: {
              $filter: {
                input: '$matchedListings',
                as: 'listing',
                cond: { $eq: ['$$listing.status', 'approved'] },
              },
            },
          },
        },
      },
    ]);

    const totalTags = await Tag.countDocuments();
    const sortedRegions = regions.filter(Boolean).sort();

    const responseData = {
      success: true,
      categories: categories || [],
      regions: sortedRegions || [],
      tags: tagsWithCount || [],
      pagination: {
        totalTags,
        currentPage: page,
        totalPages: Math.ceil(totalTags / limit),
        hasMore: page * limit < totalTags,
      },
    };

    await setCache(cacheKey, responseData, 3600);

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Meta Data Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching meta data',
      error: error.message,
    });
  }
};

const getContinentByCountry = (countryName) => {
  for (const [continent, countries] of Object.entries(continentMapping)) {
    if (countries.includes(countryName)) {
      return continent;
    }
  }
  return 'Other';
};

export const createListing = async (req, res) => {
  try {
    const {
      title,
      description,
      externalUrls,
      websiteLink,
      region,
      country,
      tradition,
      category,
      culturalTags,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an image' });
    }

    const continent = getContinentByCountry(country);

    const generatedSlug = `${slugify(title, { lower: true, strict: true })}-${Date.now()}`;
    const imageUrl = req.file.path;

    let urlList = [];
    if (externalUrls) {
      urlList = Array.isArray(externalUrls)
        ? externalUrls
        : externalUrls
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url !== '');
    }

    let tagIds = [];
    if (culturalTags) {
      tagIds = Array.isArray(culturalTags)
        ? culturalTags
        : culturalTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t !== '');
    }

    const newListing = await Listing.create({
      creatorId: req.user._id,
      slug: generatedSlug,
      title,
      description,
      externalUrls: urlList,
      websiteLink,
      continent,
      region,
      country,
      tradition,
      category,
      culturalTags: tagIds,
      image: imageUrl,
    });

    const actualCount = await Listing.countDocuments({ creatorId: req.user._id });
    await User.findByIdAndUpdate(req.user._id, {
      listingsCount: actualCount,
    });

    await invalidateListingCaches({
      id: newListing._id,
      slug: newListing.slug,
      creatorId: req.user._id,
    });

    res.status(201).json({
      message: 'Listing created successfully',
      newListing,
    });
  } catch (error) {
    console.error('Create Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized to update' });
    }

    const updateData = { ...req.body };

    let tags = [];
    if (updateData.culturalTags) {
      tags = Array.isArray(updateData.culturalTags)
        ? updateData.culturalTags
        : updateData.culturalTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t !== '');

      if (tags.length > 5) {
        return res.status(400).json({ message: 'Maximum 5 cultural tags allowed' });
      }
      listing.culturalTags = tags;
    }

    if (listing.status !== 'approved' && listing.status !== 'blocked') {
      listing.status = 'pending';
      listing.rejectionReason = '';
    }

    if (req.file) {
      if (listing.image && !listing.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), listing.image);
        if (fs.existsSync(oldImagePath)) fs.unlinkSync(oldImagePath);
      }
      listing.image = req.file.path;
    }

    const fieldsToUpdate = [
      'title',
      'description',
      'region',
      'country',
      'tradition',
      'websiteLink',
      'category',
    ];
    fieldsToUpdate.forEach((field) => {
      if (updateData[field] !== undefined) listing[field] = updateData[field];
    });

    await listing.save();
    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    const finalListing = await Listing.findById(id).populate('category culturalTags');

    res.status(200).json({
      message: listing.status === 'approved' ? 'Update successful' : 'Submitted for re-review',
      updatedListing: finalListing,
    });
  } catch (error) {
    console.error('Update Listing Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getPublicListings = async (req, res) => {
  try {
    const { filter, search, category, continent, tradition, creatorId, limit, page, offset } =
      req.query;
    const currentUserId = req.user ? req.user._id.toString() : 'anonymous';

    const queryStr = JSON.stringify({ ...req.query, currentUserId });
    const hash = crypto.createHash('md5').update(queryStr).digest('hex');
    const cacheKey = await buildVersionedCacheKey('listings:public', hash);
    const cachedData = parseCachedJson(await getCache(cacheKey));

    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    let query = { status: 'approved' };

    // ৩. ক্যাটাগরি ফিল্টার
    if (category && category !== 'All' && category !== 'undefined') {
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = category;
      } else {
        const categoryTitle = category.replace(/-/g, ' ');
        const foundCategory = await Category.findOne({
          title: { $regex: new RegExp(`^${categoryTitle}$`, 'i') },
        })
          .select('_id')
          .lean();

        if (foundCategory) query.category = foundCategory._id;
        else query.category = new mongoose.Types.ObjectId();
      }
    }

    // ৪. মহাদেশ (Continent) ফিল্টার
    if (
      continent &&
      continent !== 'All' &&
      continent !== 'All Regions' &&
      continent !== 'undefined'
    ) {
      const continentName = continent.replace(/-/g, ' ');
      query.continent = { $regex: new RegExp(`^${continentName}$`, 'i') };
    }

    // ৫. ট্র্যাডিশন ফিল্টার
    if (tradition && tradition !== 'All') {
      query.tradition = { $regex: tradition, $options: 'i' };
    }

    // ৬. ডেট ফিল্টার
    const now = new Date();
    if (filter === 'Today') {
      query.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (filter === 'This week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - 7);
      query.createdAt = { $gte: startOfWeek.setHours(0, 0, 0, 0) };
    }

    if (creatorId) query.creatorId = creatorId;

    // ৭. সার্চ লজিক
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const [matchingTags, matchingCategories] = await Promise.all([
        Tag.find({ title: searchRegex }).distinct('_id'),
        Category.find({ title: searchRegex }).distinct('_id'),
      ]);

      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { country: searchRegex },
        { continent: searchRegex },
        { culturalTags: { $in: matchingTags } },
        { category: { $in: matchingCategories } },
      ];
    }

    // ৮. পেজিনেশন ও ফেচিং (Lean ও Populate Optimization)
    const resPerPage = parseInt(limit) || 10;
    const skip = offset ? parseInt(offset) : resPerPage * (parseInt(page || 1) - 1);

    const listings = await Listing.find(query)
      .populate('creatorId', 'username profile listingsCount')
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ isPromoted: -1, 'promotion.level': -1, views: -1, createdAt: -1 })
      .limit(resPerPage)
      .skip(skip)
      .lean();

    const totalListings = await Listing.countDocuments(query);

    // ৯. ডাটা ফরম্যাটিং
    const formattedListings = await Promise.all(
      listings.map(async (item) => {
        const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

        // কাউন্টিং লজিক অপ্টিমাইজড (সরাসরি পপুলেটেড ডাটা থেকে বা শর্ট কুয়েরি)
        const creatorActiveListings = await Listing.countDocuments({
          creatorId: item.creatorId?._id,
          status: 'approved',
        });

        const effectiveIsPromoted =
          (item.promotion?.boost?.isActive && !item.promotion?.boost?.isPaused) ||
          (item.promotion?.ppc?.isActive && !item.promotion?.ppc?.isPaused);

        return {
          ...item,
          isPromoted: effectiveIsPromoted,
          isFavorited: currentUserId !== 'anonymous'
            ? safeFavorites.some((f) => f.toString() === currentUserId)
            : false,
          favoritesCount: safeFavorites.length,
          creatorStats: { totalApprovedListings: creatorActiveListings },
        };
      })
    );

    const responseData = {
      success: true,
      total: totalListings,
      count: formattedListings.length,
      currentPage: parseInt(page) || 1,
      nextOffset: skip + formattedListings.length,
      hasMore: skip + formattedListings.length < totalListings,
      listings: formattedListings,
    };

    await setCache(cacheKey, responseData, 600);

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Public Listings Error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceId } = req.query;
    const userId = req.user?._id;
    const userAgent = req.headers['user-agent'] || 'unknown';

    const cacheKey = `listing:detail:${id.toLowerCase()}`;
    const cachedListing = parseCachedJson(await getCache(cacheKey));
    let listing;

    if (cachedListing) {
      listing = cachedListing;
    } else {
      const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { slug: id };
      listing = await Listing.findOne(query)
        .populate('creatorId', 'firstName lastName username profile.profileImage')
        .populate('category', 'title')
        .populate('culturalTags', 'title image')
        .lean();

      if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });

      await Promise.all([
        setCache(cacheKey, listing, 1800),
        setCache(`listing:detail:${listing._id.toString().toLowerCase()}`, listing, 1800),
        listing.slug
          ? setCache(`listing:detail:${listing.slug.toLowerCase()}`, listing, 1800)
          : null,
      ]);
    }

    const handleViewLog = async () => {
      try {
        const actualListingId = listing._id;
        const viewQuery = { listingId: actualListingId, type: 'view' };

        if (userId) viewQuery.userId = userId;
        else if (deviceId) viewQuery.deviceId = deviceId;
        else viewQuery.userAgent = userAgent;

        const alreadyViewed = await InteractionLog.findOne(viewQuery).select('_id').lean();

        if (!alreadyViewed) {
          const today = new Date().setHours(0, 0, 0, 0);
          await Promise.all([
            Listing.findByIdAndUpdate(actualListingId, { $inc: { views: 1 } }),
            InteractionLog.create({
              listingId: actualListingId,
              userId: userId || null,
              deviceId: deviceId || 'guest_device',
              type: 'view',
              userAgent,
            }),
            Analytics.findOneAndUpdate(
              { listingId: actualListingId, date: today },
              {
                $inc: { views: 1 },
                $setOnInsert: { creatorId: listing.creatorId?._id || listing.creatorId },
              },
              { upsert: true }
            ),
          ]);
        }
      } catch (err) {
        console.error('View Logging Error:', err);
      }
    };

    handleViewLog();

    res.status(200).json(listing);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCreatorListingCount = async (req, res) => {
  try {
    const count = await Listing.countDocuments({
      creatorId: req.params.creatorId,
      status: 'approved',
    });
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json(0);
  }
};

export const getMyListings = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const currentUserId = req.user._id.toString();
    const { filter } = req.query; // query parameter থেকে ফিল্টার নিচ্ছি

    // ১. বেসিক কুয়েরি (শুধুমাত্র নিজের লিস্টিং)
    let query = { creatorId: currentUserId };

    // ২. টাইম ফিল্টারিং লজিক
    const now = new Date();
    if (filter === 'today') {
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      query.createdAt = { $gte: startOfDay };
    } else if (filter === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      query.createdAt = { $gte: startOfMonth };
    } else if (filter === 'year') {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      query.createdAt = { $gte: startOfYear };
    }

    // ৩. ডাটাবেস থেকে ডাটা আনা
    const listings = await Listing.find(query)
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 })
      .lean();

    // ৪. ডাটা ফরম্যাটিং
    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

      // প্রোমোশন স্ট্যাটাস চেক (স্কিমা অনুযায়ী)
      const isBoostActive =
        item.promotion?.boost?.isActive && new Date(item.promotion.boost.expiresAt) > new Date();
      const isPpcActive = item.promotion?.ppc?.isActive && (item.promotion.ppc.ppcBalance || 0) > 0;

      return {
        ...item,
        categoryName: item.category?.title || 'Uncategorized',
        culturalTags: (item.culturalTags || []).filter((t) => t && t._id),
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
        // ফ্রন্টএন্ডের সুবিধার জন্য প্রোমোশন স্ট্যাটাস
        isPromoted: isBoostActive || isPpcActive,
        activePromoTypes: {
          boost: isBoostActive,
          ppc: isPpcActive,
        },
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('SERVER ERROR IN GET_MY_LISTINGS:', error);
    res.status(500).json({
      message: 'Failed to fetch your listings',
      error: error.message,
    });
  }
};

export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id; 

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    ensureListingFavoriteState(listing);

    // ১. ফেভারিট অ্যাড বা রিমুভ করা
    const isFavorited = listing.favorites.some((favoriteId) => favoriteId?.equals?.(userId));

    if (isFavorited) {
      listing.favorites.pull(userId);
    } else {
      listing.favorites.addToSet(userId);
    }

    // ২. প্রোমোশন লজিক এবং লেভেল আপডেট
    // ফেভারিট কাউন্ট পরিবর্তনের ফলে র‍্যাঙ্কিং লেভেল অটোমেটিক আপডেট হবে
    applyPromotionLogic(listing);

    await listing.save();
    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    // ৩. রেসপন্স পাঠানো
    res.status(200).json({
      success: true,
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      isFavorited: !isFavorited,
      favoritesCount: listing.favorites.length,
      newLevel: listing.promotion.level, // আপডেট হওয়া লেভেল
      isPromoted: listing.isPromoted, // বুস্ট বা লেভেলের কারণে প্রমোটেড কি না
    });
  } catch (error) {
    console.error('Favorite Toggle Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getMyFavorites = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit, page, offset, category, search } = req.query;

    const query = { favorites: userId, status: 'approved' };

    if (category && mongoose.Types.ObjectId.isValid(category)) query.category = category;
    if (search) query.title = { $regex: search, $options: 'i' };

    const resPerPage = parseInt(limit) || 12;
    const skip = offset ? parseInt(offset) : resPerPage * (parseInt(page || 1) - 1);

    // ১. প্রথমে ফেভারিট লিস্টিংগুলো ফেচ করা
    const [listings, totalListings] = await Promise.all([
      Listing.find(query)
        .populate('creatorId', 'username profile firstName lastName')
        .populate('category', 'title')
        .populate('culturalTags', 'title image')
        .sort({ createdAt: -1 })
        .limit(resPerPage)
        .skip(skip)
        .lean(),
      Listing.countDocuments(query),
    ]);

    // ২. প্রতিটি লিস্টিংয়ের ক্রিয়েটরের এপ্রুভড লিস্টিং সংখ্যা বের করা (প্যারালাল কোয়েরি)
    const formattedListings = await Promise.all(
      listings.map(async (item) => {
        const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

        // ক্রিয়েটরের এপ্রুভড লিস্টিং কাউন্ট (Real-time count)
        const creatorActiveCount = await Listing.countDocuments({
          creatorId: item.creatorId?._id,
          status: 'approved',
        });

        const effectiveIsPromoted =
          (item.promotion?.boost?.isActive && !item.promotion?.boost?.isPaused) ||
          (item.promotion?.ppc?.isActive && !item.promotion?.ppc?.isPaused);

        return {
          ...item,
          isPromoted: effectiveIsPromoted,
          isFavorited: true, // যেহেতু এটি ফেভারিট লিস্ট
          favoritesCount: safeFavorites.length,
          creatorStats: {
            totalApprovedListings: creatorActiveCount,
          },
        };
      })
    );

    // ৩. ফাইনাল রেসপন্স
    res.status(200).json({
      success: true,
      total: totalListings,
      count: formattedListings.length,
      currentPage: parseInt(page) || 1,
      nextOffset: skip + formattedListings.length,
      hasMore: skip + formattedListings.length < totalListings,
      listings: formattedListings,
    });
  } catch (error) {
    console.error('Favorites Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      details: error.message,
    });
  }
};

export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (listing.image && !listing.image.startsWith('http')) {
      const imagePath = path.join(process.cwd(), listing.image);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.error('Image file delete error:', err);
        }
      }
    }

    await Listing.findByIdAndDelete(id);

    const remainingCount = await Listing.countDocuments({ creatorId: req.user._id });

    await User.findByIdAndUpdate(req.user._id, {
      listingsCount: remainingCount,
    });

    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    res.status(200).json({ message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const cancelPromotion = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const { id } = req.params;
    const { type } = req.body;

    const listing = await Listing.findById(id).session(dbSession);

    if (!listing || listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized or Listing not found' });
    }

    let refundAmount = 0;
    let updateData = {};

    if (type === 'ppc' && listing.promotion?.ppc?.isActive) {
      refundAmount = listing.promotion.ppc.ppcBalance || 0;
      updateData['promotion.ppc.ppcBalance'] = 0;
      updateData['promotion.ppc.isActive'] = false;
      updateData['promotion.ppc.amountPaid'] = 0;
    } else if (type === 'boost' && listing.promotion?.boost?.isActive) {
      updateData['promotion.boost.isActive'] = false;
      updateData['promotion.boost.amountPaid'] = 0;
      updateData['promotion.boost.expiresAt'] = null;
    }

    if (refundAmount > 0) {
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { walletBalance: Number(refundAmount.toFixed(2)) } },
        { session: dbSession }
      );
    }

    const tempListing = { ...listing.toObject() };

    if (type === 'ppc') {
      tempListing.promotion.ppc.isActive = false;
      tempListing.promotion.ppc.ppcBalance = 0;
    } else {
      tempListing.promotion.boost.isActive = false;
      tempListing.promotion.boost.amountPaid = 0;
    }

    const newLevel = calculateListingLevel(tempListing);
    updateData['promotion.level'] = newLevel;

    const isPpcStillActive = type === 'ppc' ? false : listing.promotion.ppc.isActive;
    const isBoostStillActive = type === 'boost' ? false : listing.promotion.boost.isActive;

    if (!isPpcStillActive && !isBoostStillActive) {
      updateData.isPromoted = false;
    }

    await Listing.findByIdAndUpdate(id, { $set: updateData }, { session: dbSession });

    await dbSession.commitTransaction();
    dbSession.endSession();

    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    res.status(200).json({
      success: true,
      message: `${type.toUpperCase()} cancelled. €${refundAmount.toFixed(2)} refunded to wallet.`,
      refundAmount,
    });
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    console.error('Promotion Cancel Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getModerationReasons = async (req, res) => {
  try {
    const reasonCodes = Listing.schema.path('rejectionReason').enumValues;

    // খালি ভ্যালু থাকলে সেগুলো ফিল্টার করা
    const filteredReasons = reasonCodes.filter((reason) => reason && reason !== '');

    res.status(200).json({
      success: true,
      reasons: filteredReasons,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Model or Enum path not found' });
  }
};
