import Listing from '../models/Listing.js';
import fs from 'fs';
import path from 'path';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';

export const getCategoriesAndTags = async (req, res) => {
  try {
    const categories = await Category.find().sort({ order: 1 });
    const tags = await Tag.find().sort({ title: 1 });

    res.status(200).json({
      categories: categories || [],
      tags: tags || [],
    });
  } catch (error) {
    console.error('Meta Data Error:', error);
    res.status(500).json({ message: 'Error fetching meta data', error: error.message });
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

    let updateData = { ...req.body };

    updateData.status = 'pending';
    updateData.rejectionReason = '';

    if (updateData.externalUrls) {
      updateData.externalUrls = Array.isArray(updateData.externalUrls)
        ? updateData.externalUrls
        : updateData.externalUrls
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url !== '');
    }

    if (updateData.culturalTags) {
      updateData.culturalTags = Array.isArray(updateData.culturalTags)
        ? updateData.culturalTags
        : updateData.culturalTags
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t !== '');
    }

    if (req.file) {
      if (listing.image && !listing.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), listing.image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (err) {
            console.error('Old local image delete failed:', err);
          }
        }
      }

      updateData.image = req.file.path;
    }

    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      { $set: updateData },
      { returnDocument: 'after', runValidators: true }
    ).populate('category culturalTags');

    res.status(200).json({
      message: 'Listing updated and submitted for re-review',
      updatedListing,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPublicListings = async (req, res) => {
  try {
    const { filter, search, category, region, creatorId, limit, page } = req.query;
    let query = { status: 'approved' };

    // ১. টাইম ফিল্টার ফিক্স (Error 500 এখান থেকেই আসছিল)
    const now = new Date();
    if (filter === 'Today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfDay };
    } else if (filter === 'This week') {
      const startOfWeek = new Date();
      // ৭ দিন আগের সময় সেট করা
      startOfWeek.setDate(now.getDate() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfWeek };
    }

    // ২. অন্যান্য ফিল্টার
    if (creatorId) query.creatorId = creatorId;
    if (category && category !== 'All') query.category = category;
    if (region) query.region = region;

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { tradition: { $regex: search, $options: 'i' } },
      ];
    }

    // ৩. প্যাজিনেশন লজিক
    const resPerPage = parseInt(limit) || 20;
    const currentPage = parseInt(page) || 1;
    const skip = resPerPage * (currentPage - 1);

    // ৪. ডাটা ফেচিং
    let listings = await Listing.find(query)
      .populate('creatorId', 'username profile')
      .populate('category', 'title')
      .sort({ isPromoted: -1, views: -1, createdAt: -1 })
      .limit(resPerPage)
      .skip(skip)
      .lean();

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

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ message: 'Server Error', details: error.message });
  }
};

export const getCreatorListingCount = async (req, res) => {
  try {
    const count = await Listing.countDocuments({ 
      creatorId: req.params.creatorId, 
      status: 'approved' 
    });
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json(0);
  }
};

export const getListingById = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await Listing.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true })
      .populate('creatorId', 'username firstName lastName profile email')
      .populate('category', 'title')
      .populate('culturalTags', 'title image');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.status(200).json(listing);
  } catch (error) {
    console.error('Error fetching listing details:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getMyListings = async (req, res) => {
  try {
    // ১. চেক করুন ইউজার লগইন করা কি না (Auth Middleware check)
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const currentUserId = req.user._id.toString();

    // ২. লিস্টিং ফেচ করা
    const listings = await Listing.find({ creatorId: currentUserId })
      .populate('category', 'title')
      .populate('culturalTags', 'title image') // সিম্পল পপুলেশন
      .sort({ createdAt: -1 })
      .lean();

    // ৩. ডাটা ফরম্যাটিং (সেফ চেক সহ)
    const formattedListings = listings.map((item) => {
      // নিশ্চিত করুন favorites একটি অ্যারে
      const safeFavorites = Array.isArray(item.favorites) ? item.favorites : [];

      return {
        ...item,
        // ক্যাটাগরি না থাকলে 'Uncategorized' দেখাবে
        categoryName: item.category?.title || 'Uncategorized',
        // ট্যাগ ফিল্টারিং সেফ রাখা
        culturalTags: (item.culturalTags || []).filter((t) => t && t._id),
        // বর্তমান ইউজার ফেভারিট করেছে কি না
        isFavorited: safeFavorites.some((favId) => favId?.toString() === currentUserId),
        favoritesCount: safeFavorites.length,
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    // কনসোলে এররটি দেখুন আসলে কোথায় ভুল হচ্ছে
    console.error('SERVER ERROR IN GET_MY_LISTINGS:', error);
    res.status(500).json({
      message: 'Failed to fetch your listings',
      error: error.message, // এটি ফ্রন্টএন্ডে এরর ডিবাগ করতে সাহায্য করবে
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

    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      isFavorited ? { $pull: { favorites: userId } } : { $addToSet: { favorites: userId } },
      { new: true }
    );

    res.status(200).json({
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      isFavorited: !isFavorited,
      favoritesCount: updatedListing.favorites.length,
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

    const imagePath = path.join(process.cwd(), listing.image);
    if (fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (err) {
        console.error('Image file delete error:', err);
      }
    }

    await Listing.findByIdAndDelete(id);
    res.status(200).json({ message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
