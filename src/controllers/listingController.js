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

// ─────────────────────────────────────────────
// Helper: listing-এর promotion ও favorites state নিশ্চিত করা
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Helper: country থেকে continent বের করা
// ─────────────────────────────────────────────
const getContinentByCountry = (countryName) => {
  for (const [continent, countries] of Object.entries(continentMapping)) {
    if (countries.includes(countryName)) {
      return continent;
    }
  }
  return 'Other';
};

// ─────────────────────────────────────────────
// PPC Click Handle করা
// ─────────────────────────────────────────────
export const handlePpcClick = async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceId } = req.body;
    const userId = req.user?._id;

    if (!deviceId) return res.status(400).json({ message: 'Security token (deviceId) missing.' });

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    // PPC active না থাকলে বা balance না থাকলে organic click
    if (!listing.promotion?.ppc?.isActive || listing.promotion.ppc.ppcBalance <= 0) {
      return res.status(200).json({ success: true, message: 'Organic click recorded.' });
    }

    // Campaign pause থাকলে organic click
    if (listing.promotion.ppc.isPaused) {
      return res
        .status(200)
        .json({ success: true, message: 'Campaign paused, organic click recorded.' });
    }

    // Duplicate click চেক করা
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
      // FIX: totalClicks ও বাড়ানো হচ্ছে (আগে missing ছিল)
      listing.promotion.ppc.totalClicks = (listing.promotion.ppc.totalClicks || 0) + 1;

      let isBudgetExhausted = false;

      if (listing.promotion.ppc.ppcBalance < cost) {
        resetPPC(listing);
        isBudgetExhausted = true;
      }

      applyPromotionLogic(listing);
      await listing.save();

      // Cache invalidate করা
      await invalidateListingCaches({
        id: listing._id,
        slug: listing.slug,
        creatorId: listing.creatorId,
      });

      // Interaction log তৈরি
      await InteractionLog.create({
        listingId: id,
        userId: userId || null,
        deviceId: deviceId,
        type: 'ppc_click',
      });

      // Audit log
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

      // Analytics update
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

// ─────────────────────────────────────────────
// Categories, Tags ও Regions fetch করা
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Listing তৈরি করা
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Listing আপডেট করা
// ─────────────────────────────────────────────
export const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized to update' });
    }

    const updateData = { ...req.body };

    // Cultural tags validate ও update
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

    // Approved বা blocked ছাড়া অন্য status হলে pending-এ নামানো
    if (listing.status !== 'approved' && listing.status !== 'blocked') {
      listing.status = 'pending';
      listing.rejectionReason = '';
    }

    // নতুন image থাকলে পুরনো image delete করা
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

    // FIX: country পরিবর্তন হলে continent ও update করা (আগে missing ছিল)
    if (updateData.country) {
      listing.continent = getContinentByCountry(updateData.country);
    }

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

// ─────────────────────────────────────────────
// Public listings fetch করা
// ─────────────────────────────────────────────
export const getPublicListings = async (req, res) => {
  try {
    const { filter, search, category, continent, tradition, creatorId, limit, page, offset } =
      req.query;
    const currentUserId = req.user ? req.user._id.toString() : 'anonymous';

    // Cache key তৈরি
    const queryStr = JSON.stringify({ ...req.query, currentUserId });
    const hash = crypto.createHash('md5').update(queryStr).digest('hex');
    const cacheKey = await buildVersionedCacheKey('listings:public', hash);
    const cachedData = parseCachedJson(await getCache(cacheKey));

    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    let query = { status: 'approved' };

    // Category filter
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

    // Continent filter
    if (
      continent &&
      continent !== 'All' &&
      continent !== 'All Regions' &&
      continent !== 'undefined'
    ) {
      const continentSlug = continent.toLowerCase().trim();
      query.continent = { $regex: new RegExp(`^${continentSlug}$`, 'i') };
    }

    // Tradition filter
    if (tradition && tradition !== 'All') {
      query.tradition = { $regex: tradition, $options: 'i' };
    }

    // Date filter
    const now = new Date();
    if (filter === 'Today') {
      query.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (filter === 'This week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - 7);
      query.createdAt = { $gte: startOfWeek.setHours(0, 0, 0, 0) };
    }

    if (creatorId) query.creatorId = creatorId;

    // Search filter
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

    const resPerPage = parseInt(limit) || 10;
    const skip = offset ? parseInt(offset) : resPerPage * (parseInt(page || 1) - 1);

    const [listings, totalListings] = await Promise.all([
      Listing.find(query)
        .populate('creatorId', 'username profile listingsCount')
        .populate('category', 'title')
        .populate('culturalTags', 'title image')
        .sort({ isPromoted: -1, 'promotion.level': -1, views: -1, createdAt: -1 })
        .limit(resPerPage)
        .skip(skip)
        .lean(),
      Listing.countDocuments(query),
    ]);

    // FIX: N+1 query সমস্যা সমাধান — সব creatorId একসাথে aggregate করা
    const creatorIds = [...new Set(listings.map((l) => l.creatorId?._id?.toString()).filter(Boolean))];

    const creatorListingCounts = await Listing.aggregate([
      {
        $match: {
          creatorId: { $in: creatorIds.map((id) => new mongoose.Types.ObjectId(id)) },
          status: 'approved',
        },
      },
      {
        $group: {
          _id: '$creatorId',
          count: { $sum: 1 },
        },
      },
    ]);

    const creatorCountMap = {};
    creatorListingCounts.forEach((entry) => {
      creatorCountMap[entry._id.toString()] = entry.count;
    });

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      const creatorId = item.creatorId?._id?.toString();

      const effectiveIsPromoted =
        (item.promotion?.boost?.isActive && !item.promotion?.boost?.isPaused) ||
        (item.promotion?.ppc?.isActive && !item.promotion?.ppc?.isPaused);

      return {
        ...item,
        isPromoted: effectiveIsPromoted,
        isFavorited:
          currentUserId !== 'anonymous'
            ? safeFavorites.some((f) => f.toString() === currentUserId)
            : false,
        favoritesCount: safeFavorites.length,
        creatorStats: {
          totalApprovedListings: creatorCountMap[creatorId] || 0,
        },
      };
    });

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
// SHARED UTILITY: category-র listing গুলো rank করা + creator populate করা
// FIX: creatorStats.totalApprovedListings যোগ করা হয়েছে
// ─────────────────────────────────────────────────────────────────────────────
const getRankedListingsByCategory = async (categoryId) => {
  // ১. প্রথমে এই ক্যাটাগরির পিন করা লিস্টিংগুলো খুঁজে বের করা
  const pinnedListings = await Listing.aggregate([
    {
      $match: {
        category: new mongoose.Types.ObjectId(categoryId),
        status: 'approved',
        'promotion.pinnedPosition': { $in: [1, 2, 3, 4] }, // শুধুমাত্র ১-৪ স্লটে পিন করাগুলো
      },
    },
    // ... আপনার বাকি সব Lookup এবং Project একই থাকবে ...
    ...getCommonPipelineParts()
  ]);

  // ২. পিন করা লিস্টিংগুলোর আইডি আলাদা করা যাতে তারা জেনারেল র‍্যাঙ্কিংয়ে না আসে
  const pinnedIds = pinnedListings.map(l => l._id);

  // ৩. জেনারেল র‍্যাঙ্কড লিস্টিং নিয়ে আসা (পিন করাগুলো বাদ দিয়ে)
  const rankedListings = await Listing.aggregate([
    {
      $match: {
        category: new mongoose.Types.ObjectId(categoryId),
        status: 'approved',
        _id: { $nin: pinnedIds }, // পিন করা লিস্টিং বাদ
      },
    },
    {
      $addFields: {
        rankScore: {
          $add: [
            { $cond: [{ $eq: ['$promotion.ppc.isActive', true] }, 100, 0] },
            { $multiply: [{ $ifNull: ['$views', 0] }, 0.5] },
            { $multiply: [{ $ifNull: ['$promotion.ppc.totalClicks', 0] }, 2] },
            {
              $cond: [
                { $gt: ['$createdAt', new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)] },
                10,
                0,
              ],
            },
          ],
        },
      },
    },
    { $sort: { rankScore: -1, createdAt: -1 } },
    { $limit: 4 }, // সেফটির জন্য ৪টা নিলেই হবে
    ...getCommonPipelineParts()
  ]);

  // ৪. ফাইনাল ৪টি স্লট তৈরি করা [Slot 1, Slot 2, Slot 3, Slot 4]
  const finalCurated = [null, null, null, null];

  // ৫. পিন করা লিস্টিংগুলোকে তাদের নির্দিষ্ট পজিশনে বসানো
  pinnedListings.forEach(item => {
    const pos = item.promotion.pinnedPosition;
    if (pos >= 1 && pos <= 4) {
      finalCurated[pos - 1] = item;
    }
  });

  // ৬. বাকি খালি স্লটগুলো র‍্যাঙ্কড লিস্টিং দিয়ে সিরিয়ালি ফিলাপ করা
  let rankedIdx = 0;
  for (let i = 0; i < 4; i++) {
    if (finalCurated[i] === null && rankedListings[rankedIdx]) {
      finalCurated[i] = rankedListings[rankedIdx];
      rankedIdx++;
    }
  }

  // নাল ভ্যালু ফিল্টার করে (যদি ক্যাটাগরিতে লিস্টিং ৪টার কম থাকে) রিটার্ন করা
  return finalCurated.filter(item => item !== null);
};

// কোড পরিষ্কার রাখার জন্য কমন পাইপলাইন পার্টস (Lookup & Project) এখানে রাখা হয়েছে
function getCommonPipelineParts() {
  return [
    {
      $lookup: {
        from: 'users',
        localField: 'creatorId',
        foreignField: '_id',
        as: 'creatorData',
      },
    },
    { $unwind: { path: '$creatorData', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryData',
      },
    },
    { $unwind: { path: '$categoryData', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'tags',
        localField: 'culturalTags',
        foreignField: '_id',
        as: 'culturalTagsData',
      },
    },
    {
      $lookup: {
        from: 'listings',
        let: { cId: '$creatorData._id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$creatorId', '$$cId'] }, status: 'approved' } },
          { $count: 'total' },
        ],
        as: 'creatorListingsCount',
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        slug: 1,
        image: 1,
        views: 1,
        rankScore: 1,
        createdAt: 1,
        favorites: 1,
        promotion: 1,
        isPromoted: 1,
        status: 1,
        region: 1,
        country: 1,
        continent: 1,
        tradition: 1,
        description: 1,
        websiteLink: 1,
        externalUrls: 1,
        category: {
          _id: '$categoryData._id',
          title: { $ifNull: ['$categoryData.title', ''] },
        },
        culturalTags: '$culturalTagsData',
        creatorId: {
          _id: '$creatorData._id',
          username: { $ifNull: ['$creatorData.username', ''] },
          profile: {
            displayName: { $ifNull: ['$creatorData.profile.displayName', '$creatorData.username'] },
            profileImage: { $ifNull: ['$creatorData.profile.profileImage', null] },
            coverImage: { $ifNull: ['$creatorData.profile.coverImage', null] },
            bio: { $ifNull: ['$creatorData.profile.bio', ''] },
            city: { $ifNull: ['$creatorData.profile.city', ''] },
          },
        },
        creatorStats: {
          totalApprovedListings: { $ifNull: [{ $arrayElemAt: ['$creatorListingsCount.total', 0] }, 0] },
        },
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CURATED COLLECTIONS — প্রতিটা category থেকে top-4 ranked listing
// ─────────────────────────────────────────────────────────────────────────────
export const getCuratedCollections = async (req, res) => {
  try {
    const SELECTED_CATEGORY_IDS = [
      '69ec7fdab5aac78d87858af3',
      '69ec7f56b5aac78d87858adb', // CULTURAL TEXTILES
      '69ec7fe6b5aac78d87858af7',
      '69ec7ff0b5aac78d87858afb',
      '69ec7f6ab5aac78d87858adf', // TRADITIONAL CLOTHING
      '69ec7f1eb5aac78d87858ad1', // HANDMADE CRAFTS
      '69ec7ffbb5aac78d87858aff',
      '69ec7fbfb5aac78d87858ae7',
    ];

    const dayOfMonth = new Date().getDate();
    const startIndex = dayOfMonth % 2 === 0 ? 0 : 4;
    const dailyCategoryIds = SELECTED_CATEGORY_IDS.slice(startIndex, startIndex + 4);

    const results = await Promise.all(
      dailyCategoryIds.map(async (catId) => {
        const categoryInfo = await Category.findById(catId).select('title').lean();

        const generatedSlug = categoryInfo?.title
          ? categoryInfo.title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
          : 'unknown';

        const allRanked = await getRankedListingsByCategory(catId);
        const topListings = allRanked.slice(0, 4);

        // listing না থাকলে এই category বাদ
        if (topListings.length === 0) return null;

        return {
          categoryId: catId,
          categoryTitle: categoryInfo?.title || 'Unknown Category',
          categorySlug: generatedSlug,
          listings: topListings,
        };
      })
    );

    // null গুলো filter করে বাদ
    const filteredResults = results.filter(Boolean);

    res.status(200).json({ success: true, data: filteredResults });
  } catch (error) {
    console.error('Curated Collections Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching collections',
      error: error.message,
    });
  }
};

export const getTrendingListings = async (req, res) => {
  try {
    const { limit = 8, page = 1 } = req.query;
    const currentUserId = req.user ? req.user._id.toString() : 'anonymous';

    const resPerPage = parseInt(limit);
    const skip = (parseInt(page) - 1) * resPerPage;

    // ── Step 1: আজকের active category IDs ──
    const SELECTED_CATEGORY_IDS = [
      '69ec7f1eb5aac78d87858ad1',
      '69ec7f6ab5aac78d87858adf',
      '69ec7f56b5aac78d87858adb',
      '69ec7fdab5aac78d87858af3',
      '69ec7fe6b5aac78d87858af7',
      '69ec7ff0b5aac78d87858afb',
      '69ec7ffbb5aac78d87858aff',
      '69ec7fbfb5aac78d87858ae7',
    ];

    const dayOfMonth = new Date().getDate();
    const startIndex = dayOfMonth % 2 === 0 ? 0 : 4;
    const dailyCategoryIds = SELECTED_CATEGORY_IDS.slice(startIndex, startIndex + 4);

    // ── Step 2: Curated top-4 IDs বের করা এবং ObjectId তে কনভার্ট করা ──
    const curatedIdArrays = await Promise.all(
      dailyCategoryIds.map(async (catId) => {
        const allRanked = await getRankedListingsByCategory(catId);
        // নিশ্চিত করছি আইডিগুলো যেন Mongoose ObjectId ফরম্যাটে থাকে
        return allRanked.slice(0, 4).map((l) => new mongoose.Types.ObjectId(l._id));
      })
    );
    const curatedListingIds = curatedIdArrays.flat();

    // ── Step 3: Rank pipeline (curated বাদ দিয়ে) ──
    const rankPipeline = [
      {
        $match: {
          status: 'approved',
          // কিউরেটেড আইডিগুলো ট্রেন্ডিং থেকে বাদ দেওয়া হচ্ছে
          ...(curatedListingIds.length > 0 && {
            _id: { $nin: curatedListingIds },
          }),
        },
      },
      {
        $addFields: {
          rankScore: {
            $add: [
              { $cond: [{ $eq: ['$promotion.ppc.isActive', true] }, 100, 0] },
              { $multiply: [{ $ifNull: ['$views', 0] }, 0.5] },
              { $multiply: [{ $ifNull: ['$promotion.ppc.totalClicks', 0] }, 2] },
              {
                $cond: [
                  { $gt: ['$createdAt', new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)] },
                  10,
                  0,
                ],
              },
            ],
          },
        },
      },
      { $sort: { rankScore: -1, createdAt: -1 } },
    ];

    // Total count বের করা
    const totalResult = await Listing.aggregate([...rankPipeline, { $count: 'total' }]);
    const total = totalResult[0]?.total || 0;

    // ── Step 4: Paginated + Populated ──
    const listings = await Listing.aggregate([
      ...rankPipeline,
      { $skip: skip },
      { $limit: resPerPage },

      // Creator lookup
      {
        $lookup: {
          from: 'users',
          localField: 'creatorId',
          foreignField: '_id',
          as: 'creatorData',
        },
      },
      { $unwind: { path: '$creatorData', preserveNullAndEmptyArrays: true } },

      // Category lookup
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'categoryData',
        },
      },
      { $unwind: { path: '$categoryData', preserveNullAndEmptyArrays: true } },

      // Cultural tags lookup
      {
        $lookup: {
          from: 'tags',
          localField: 'culturalTags',
          foreignField: '_id',
          as: 'culturalTagsData',
        },
      },

      // Project final fields
      {
        $project: {
          _id: 1,
          title: 1,
          slug: 1,
          image: 1,
          views: 1,
          rankScore: 1,
          createdAt: 1,
          favorites: 1,
          promotion: 1,
          isPromoted: 1,
          status: 1,
          region: 1,
          country: 1,
          continent: 1,
          tradition: 1,
          description: 1,
          websiteLink: 1,
          externalUrls: 1,
          category: {
            _id: '$categoryData._id',
            title: { $ifNull: ['$categoryData.title', ''] },
          },
          culturalTags: '$culturalTagsData',
          creatorId: {
            _id: '$creatorData._id',
            username: { $ifNull: ['$creatorData.username', ''] },
            listingsCount: { $ifNull: ['$creatorData.listingsCount', 0] },
            profile: {
              displayName: {
                $ifNull: [
                  '$creatorData.profile.displayName',
                  { $ifNull: ['$creatorData.username', ''] },
                ],
              },
              profileImage: { $ifNull: ['$creatorData.profile.profileImage', null] },
              bio: { $ifNull: ['$creatorData.profile.bio', ''] },
            },
          },
        },
      },
    ]);

    // ── Step 5: Creator stats aggregate (N+1 fix) ──
    const creatorIds = [
      ...new Set(listings.map((l) => l.creatorId?._id?.toString()).filter(Boolean)),
    ];

    const creatorCountMap = {};
    if (creatorIds.length > 0) {
      const counts = await Listing.aggregate([
        {
          $match: {
            creatorId: { $in: creatorIds.map((id) => new mongoose.Types.ObjectId(id)) },
            status: 'approved',
          },
        },
        { $group: { _id: '$creatorId', count: { $sum: 1 } } },
      ]);
      counts.forEach((e) => {
        creatorCountMap[e._id.toString()] = e.count;
      });
    }

    // ── Step 6: Format ──
    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      const creatorIdStr = item.creatorId?._id?.toString();

      const effectiveIsPromoted =
        (item.promotion?.boost?.isActive && !item.promotion?.boost?.isPaused) ||
        (item.promotion?.ppc?.isActive && !item.promotion?.ppc?.isPaused);

      return {
        ...item,
        isPromoted: effectiveIsPromoted,
        isFavorited:
          currentUserId !== 'anonymous'
            ? safeFavorites.some((f) => f.toString() === currentUserId)
            : false,
        favoritesCount: safeFavorites.length,
        creatorStats: {
          totalApprovedListings: creatorCountMap[creatorIdStr] || 0,
        },
      };
    });

    res.status(200).json({
      success: true,
      total,
      count: formattedListings.length,
      currentPage: parseInt(page),
      nextOffset: skip + formattedListings.length,
      hasMore: skip + formattedListings.length < total,
      listings: formattedListings,
    });
  } catch (error) {
    console.error('Trending Listings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching trending listings',
      error: error.message,
    });
  }
};
// ─────────────────────────────────────────────
// Single Listing fetch করা (by ID বা slug)
// ─────────────────────────────────────────────
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

    // View log async হ্যান্ডেল করা — response block করে না
    const handleViewLog = async () => {
      try {
        const actualListingId = listing._id.toString();
        const viewQuery = { listingId: actualListingId, type: 'view' };

        if (userId) {
          viewQuery.userId = userId;
        } else if (deviceId && deviceId !== 'undefined') {
          viewQuery.deviceId = deviceId;
        } else {
          viewQuery.deviceId = userAgent;
        }

        const alreadyViewed = await InteractionLog.findOne(viewQuery).select('_id').lean();

        if (!alreadyViewed) {
          const today = new Date().setHours(0, 0, 0, 0);
          const creatorId = listing.creatorId?._id || listing.creatorId;

          await Promise.all([
            Listing.findByIdAndUpdate(actualListingId, { $inc: { views: 1 } }),
            InteractionLog.create({
              listingId: actualListingId,
              userId: userId || null,
              deviceId: viewQuery.deviceId || 'guest_device',
              type: 'view',
              userAgent,
            }),
            Analytics.findOneAndUpdate(
              { listingId: actualListingId, date: today },
              {
                $inc: { views: 1 },
                $setOnInsert: { creatorId: creatorId },
              },
              { upsert: true }
            ),
          ]);

          // FIX: View বাড়ার পরে cache invalidate করা (আগে missing ছিল)
          await invalidateListingCaches({
            id: actualListingId,
            slug: listing.slug,
            creatorId: creatorId,
          });
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

// ─────────────────────────────────────────────
// Creator-এর approved listing count
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// নিজের listings fetch করা
// ─────────────────────────────────────────────
export const getMyListings = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const currentUserId = req.user._id.toString();
    const { filter } = req.query;

    let query = { creatorId: currentUserId };

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

    const listings = await Listing.find(query)
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 })
      .lean();

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      const isBoostActive =
        item.promotion?.boost?.isActive && new Date(item.promotion.boost.expiresAt) > new Date();
      const isPpcActive = item.promotion?.ppc?.isActive && (item.promotion.ppc.ppcBalance || 0) > 0;

      return {
        ...item,
        categoryName: item.category?.title || 'Uncategorized',
        culturalTags: (item.culturalTags || []).filter((t) => t && t._id),
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
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

// ─────────────────────────────────────────────
// Favorite toggle করা
// ─────────────────────────────────────────────
export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    ensureListingFavoriteState(listing);

    const isFavorited = listing.favorites.some((favoriteId) => favoriteId?.equals?.(userId));

    if (isFavorited) {
      listing.favorites.pull(userId);
    } else {
      listing.favorites.addToSet(userId);
    }

    applyPromotionLogic(listing);
    await listing.save();
    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    res.status(200).json({
      success: true,
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      isFavorited: !isFavorited,
      favoritesCount: listing.favorites.length,
      newLevel: listing.promotion.level,
      isPromoted: listing.isPromoted,
    });
  } catch (error) {
    console.error('Favorite Toggle Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// নিজের favorites fetch করা
// ─────────────────────────────────────────────
export const getMyFavorites = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit, page, offset, category, search } = req.query;

    const query = { favorites: userId, status: 'approved' };

    if (category && mongoose.Types.ObjectId.isValid(category)) query.category = category;
    if (search) query.title = { $regex: search, $options: 'i' };

    const resPerPage = parseInt(limit) || 12;
    const skip = offset ? parseInt(offset) : resPerPage * (parseInt(page || 1) - 1);

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

    // FIX: N+1 query সমস্যা সমাধান — সব creator একসাথে aggregate করা
    const creatorIds = [...new Set(listings.map((l) => l.creatorId?._id?.toString()).filter(Boolean))];

    const creatorListingCounts = await Listing.aggregate([
      {
        $match: {
          creatorId: { $in: creatorIds.map((id) => new mongoose.Types.ObjectId(id)) },
          status: 'approved',
        },
      },
      {
        $group: {
          _id: '$creatorId',
          count: { $sum: 1 },
        },
      },
    ]);

    const creatorCountMap = {};
    creatorListingCounts.forEach((entry) => {
      creatorCountMap[entry._id.toString()] = entry.count;
    });

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      const creatorId = item.creatorId?._id?.toString();

      const effectiveIsPromoted =
        (item.promotion?.boost?.isActive && !item.promotion?.boost?.isPaused) ||
        (item.promotion?.ppc?.isActive && !item.promotion?.ppc?.isPaused);

      return {
        ...item,
        isPromoted: effectiveIsPromoted,
        isFavorited: true,
        favoritesCount: safeFavorites.length,
        creatorStats: {
          totalApprovedListings: creatorCountMap[creatorId] || 0,
        },
      };
    });

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

// ─────────────────────────────────────────────
// Listing delete করা
// ─────────────────────────────────────────────
export const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Local image file delete করা
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

// ─────────────────────────────────────────────
// Promotion cancel করা (boost বা ppc)
// ─────────────────────────────────────────────
export const cancelPromotion = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const { id } = req.params;
    const { type } = req.body;

    const listing = await Listing.findById(id).session(dbSession);

    if (!listing || listing.creatorId.toString() !== req.user._id.toString()) {
      await dbSession.abortTransaction();
      dbSession.endSession();
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
      // FIX: Boost cancel-এও refund logic যোগ করা হয়েছে
      // Note: Boost সাধারণত non-refundable, কিন্তু যদি partial refund দরকার হয়
      // তাহলে এখানে business logic যোগ করুন।
      // এখন শুধু deactivate করা হচ্ছে।
      updateData['promotion.boost.isActive'] = false;
      updateData['promotion.boost.amountPaid'] = 0;
      updateData['promotion.boost.expiresAt'] = null;
    }

    // Refund wallet-এ যোগ করা (ppc-র ক্ষেত্রে)
    if (refundAmount > 0) {
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { walletBalance: Number(refundAmount.toFixed(2)) } },
        { session: dbSession }
      );
    }

    // Promotion বন্ধ করার পরে নতুন level হিসাব করা
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

    const isPpcStillActive = type === 'ppc' ? false : listing.promotion?.ppc?.isActive;
    const isBoostStillActive = type === 'boost' ? false : listing.promotion?.boost?.isActive;

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

// ─────────────────────────────────────────────
// Moderation rejection reasons fetch করা
// ─────────────────────────────────────────────
export const getModerationReasons = async (req, res) => {
  try {
    const reasonCodes = Listing.schema.path('rejectionReason').enumValues;
    const filteredReasons = reasonCodes.filter((reason) => reason && reason !== '');
    res.status(200).json({
      success: true,
      reasons: filteredReasons,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Model or Enum path not found' });
  }
};