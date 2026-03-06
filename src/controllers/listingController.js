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

export const getCategoriesAndTags = async (req, res) => {
  try {
    const [categories, regions] = await Promise.all([
      Category.find().sort({ order: 1 }).lean(),
      mongoose.model('Listing').distinct('region', { status: 'approved' }),
    ]);

    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
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

    res.status(200).json({
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
    });
  } catch (error) {
    console.error('Meta Data Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching meta data',
      error: error.message,
    });
  }
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
      title,
      description,
      externalUrls: urlList,
      websiteLink,
      region,
      country,
      tradition,
      category,
      culturalTags: tagIds,
      image: imageUrl,
    });

    res.status(201).json({ message: 'Listing created successfully', newListing });
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

    // 🔹 Tag Restriction (Max 5)
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

    if (listing.status !== 'approved') {
      listing.status = 'pending';
      listing.rejectionReason = '';
    }

    // 🔹 Image Update
    if (req.file) {
      if (listing.image && !listing.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), listing.image);
        if (fs.existsSync(oldImagePath)) fs.unlinkSync(oldImagePath);
      }
      listing.image = req.file.path;
    }

    // 🔹 Field Updates
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
    const finalListing = await Listing.findById(id).populate('category culturalTags');

    res.status(200).json({
      message: listing.status === 'approved' ? 'Update successful' : 'Submitted for re-review',
      updatedListing: finalListing,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPublicListings = async (req, res) => {
  try {
    const { filter, search, category, region, tradition, creatorId, limit, page, offset } =
      req.query;

    let query = { status: 'approved' };

    if (category && category !== 'All' && category !== 'undefined') {
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = category;
      } else {
        const foundCategory = await Category.findOne({
          title: { $regex: category, $options: 'i' },
        });
        if (foundCategory) {
          query.category = foundCategory._id;
        } else {
          query.category = new mongoose.Types.ObjectId();
        }
      }
    }

    if (region && region !== 'All') query.region = region;
    if (tradition && tradition !== 'All') {
      query.tradition = { $regex: tradition, $options: 'i' };
    }

    const now = new Date();
    if (filter === 'Today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfDay };
    } else if (filter === 'This week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfWeek };
    }

    if (creatorId) query.creatorId = creatorId;

    if (search) {
      const [matchingTags, matchingCategories] = await Promise.all([
        Tag.find({ title: { $regex: search, $options: 'i' } })
          .select('_id')
          .lean(),
        Category.find({ title: { $regex: search, $options: 'i' } })
          .select('_id')
          .lean(),
      ]);

      const tagIds = matchingTags.map((t) => t._id);
      const catIds = matchingCategories.map((c) => c._id);

      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { region: { $regex: search, $options: 'i' } },
        { culturalTags: { $in: tagIds } },
        { category: { $in: catIds } },
      ];
    }

    const resPerPage = parseInt(limit) || 10;

    const skip = offset ? parseInt(offset) : resPerPage * (parseInt(page || 1) - 1);

    let listings = await Listing.find(query)
      .populate('creatorId', 'username profile')
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({
        isPromoted: -1,
        'promotion.level': -1,
        views: -1,
        createdAt: -1,
      })
      .limit(resPerPage)
      .skip(skip)
      .lean();

    const totalListings = await Listing.countDocuments(query);
    const currentUserId = req.user ? req.user._id.toString() : null;

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      return {
        ...item,
        isFavorited: currentUserId
          ? safeFavorites.some((favId) => favId.toString() === currentUserId)
          : false,
        favoritesCount: safeFavorites.length,
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
    console.error('Public Listings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      details: error.message,
    });
  }
};

// const clickCooldowns = new Map();
// const viewCache = new Map();

// export const handlePpcClick = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

//     const listing = await Listing.findById(id);
//     if (!listing) return res.status(404).json({ message: 'Listing not found' });

//     // ১. চেক: পিপিছি একটিভ আছে কি না
//     if (!listing.promotion.ppc.isActive || listing.promotion.ppc.ppcBalance <= 0) {
//       return res.status(200).json({ success: true, message: 'Organic click, no deduction.' });
//     }

//     // ২. ২৪ ঘণ্টা রেস্ট্রিকশন চেক (Analytics মডেল ব্যবহার করে)
//     const now = new Date();
//     const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

//     // আমরা এনালাইটিক্স মডেলে চেক করবো এই IP থেকে গত ২৪ ঘণ্টায় কোনো ক্লিক হয়েছে কি না
//     // এর জন্য এনালাইটিক্স মডেলে 'userIp' ফিল্ডটি থাকলে ভালো হয়, নাহলে আমরা ডেট দিয়ে চেক করছি
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     // লজিক: একই লিস্টিং এ ২৪ ঘণ্টার মধ্যে ডাবল ক্লিক ডিডাকশন হবে না
//     // এখানে আমরা চেক করছি যদি অলরেডি ক্লিক কাউন্ট হয়ে থাকে তবে শুধু রিটার্ন করবে
//     // (প্রফেশনাল সিস্টেমে এখানে IP Log টেবিল লাগে, আমরা Analytics দিয়ে ম্যানেজ করছি)

//     const stats = await Analytics.findOneAndUpdate(
//       { listingId: id, date: today },
//       { $setOnInsert: { creatorId: listing.creatorId, listingId: id, date: today } },
//       { upsert: true, new: true }
//     );

//     // যদি ব্যালেন্স থাকে তবেই টাকা কাটবো
//     const cost = listing.promotion.ppc.costPerClick || 0.1;

//     if (listing.promotion.ppc.ppcBalance >= cost) {
//       listing.promotion.ppc.ppcBalance = Number(
//         (listing.promotion.ppc.ppcBalance - cost).toFixed(2)
//       );
//       listing.promotion.ppc.executedClicks += 1;

//       // এনালাইটিক্স আপডেট
//       stats.clicks += 1;
//       await stats.save();

//       // যদি ব্যালেন্স ০ হয়ে যায় তবে ক্যাম্পেইন অফ করে দাও
//       if (listing.promotion.ppc.ppcBalance <= 0) {
//         listing.promotion.ppc.isActive = false;
//         listing.isPromoted = listing.promotion.boost.isActive;
//       }

//       await listing.save();
//       return res.status(200).json({ success: true, balance: listing.promotion.ppc.ppcBalance });
//     }

//     res.status(200).json({ success: true, message: 'Insufficient balance for deduction.' });
//   } catch (error) {
//     console.error('PPC Click Error:', error);
//     res.status(500).json({ message: 'Internal server error' });
//   }
// };

// export const getListingById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

//     const listing = await Listing.findById(id)
//       .populate('creatorId', 'firstName lastName username profile.image')
//       .populate('category', 'title')
//       .populate('culturalTags', 'title image');

//     if (!listing) return res.status(404).json({ message: 'Listing not found' });

//     // View Tracking with simple IP-based cooldown
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     listing.views += 1;
//     await listing.save();

//     res.status(200).json(listing);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const listing = await Listing.findById(id)
      .populate('creatorId', 'firstName lastName username profile.image')
      .populate('category', 'title');

    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    // ২৪ ঘণ্টা ভিউ চেক
    const alreadyViewed = await InteractionLog.findOne({
      listingId: id,
      ip: userIp,
      type: 'view',
    });

    if (!alreadyViewed) {
      // ডাটাবেসে ভিউ বাড়ানো
      listing.views += 1;
      await listing.save();

      // লগ তৈরি করা
      await InteractionLog.create({ listingId: id, ip: userIp, type: 'view' });

      // এনালাইটিক্স আপডেট (Daily Stats)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await Analytics.findOneAndUpdate(
        { listingId: id, date: today },
        { $inc: { views: 1 }, $setOnInsert: { creatorId: listing.creatorId } },
        { upsert: true }
      );
    }

    res.status(200).json(listing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const handlePpcClick = async (req, res) => {
  try {
    const { id } = req.params;
    const userIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    // পিপিছি একটিভ চেক
    if (!listing.promotion.ppc.isActive || listing.promotion.ppc.ppcBalance <= 0) {
      return res.status(200).json({ message: 'Organic click.' });
    }

    // ২৪ ঘণ্টা ক্লিক চেক (একই আইপি থেকে ২৪ ঘণ্টায় একবারই টাকা কাটবে)
    const alreadyClicked = await InteractionLog.findOne({
      listingId: id,
      ip: userIp,
      type: 'ppc_click',
    });

    if (alreadyClicked) {
      return res.status(200).json({ message: 'Click already recorded for today.' });
    }

    const cost = listing.promotion.ppc.costPerClick || 0.1;

    if (listing.promotion.ppc.ppcBalance >= cost) {
      // টাকা কাটা এবং ক্লিক কাউন্ট বাড়ানো
      listing.promotion.ppc.ppcBalance = Number(
        (listing.promotion.ppc.ppcBalance - cost).toFixed(2)
      );
      listing.promotion.ppc.executedClicks += 1;

      // যদি ব্যালেন্স শেষ হয়ে যায়
      if (listing.promotion.ppc.ppcBalance <= 0) {
        listing.promotion.ppc.isActive = false;
        listing.isPromoted =
          listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > new Date();
      }

      await listing.save();

      // লগ এবং এনালাইটিক্স আপডেট
      await InteractionLog.create({ listingId: id, ip: userIp, type: 'ppc_click' });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await Analytics.findOneAndUpdate(
        { listingId: id, date: today },
        { $inc: { clicks: 1 }, $setOnInsert: { creatorId: listing.creatorId } },
        { upsert: true }
      );

      return res.status(200).json({ success: true, balance: listing.promotion.ppc.ppcBalance });
    }

    res.status(400).json({ message: 'Insufficient balance.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    const listings = await Listing.find({ creatorId: currentUserId })
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 })
      .lean();

    const formattedListings = listings.map((item) => {
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];
      return {
        ...item,
        categoryName: item.category?.title || 'Uncategorized',
        culturalTags: (item.culturalTags || []).filter((t) => t && t._id),
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
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
    const userId = req.user._id;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const isFavorited = listing.favorites.includes(userId);
    if (isFavorited) {
      listing.favorites.pull(userId);
    } else {
      listing.favorites.addToSet(userId);
    }

    listing.promotion.level = calculateListingLevel(listing);

    await listing.save();

    res.status(200).json({
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      isFavorited: !isFavorited,
      favoritesCount: listing.favorites.length,
      newLevel: listing.promotion.level,
    });
  } catch (error) {
    console.error('Favorite Toggle Error:', error);
    res.status(500).json({ message: 'Server error' });
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
