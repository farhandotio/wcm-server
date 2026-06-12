import User from '../models/User.js';
import Listing from '../models/Listing.js';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import Transaction from '../models/Transaction.js';
import Analytics from '../models/Analytics.js';
import AuditLog from '../models/AuditLog.js';
import mongoose from 'mongoose';
import Visitor from '../models/Visitor.js';
import Region from '../models/Region.js';
import Tradition from '../models/Tradition.js';
import HowItWork from '../models/howItWork.js';
import {
  invalidateListingCaches,
  invalidateMetaCaches,
  invalidateUserProfileCaches,
} from '../utils/cache.js';
import { fileURLToPath } from 'url';
import { backupDB } from '../utils/dbBackup.js';
import { restoreDB } from '../utils/dbRestore.js';


// Get Regions by Category
export const getRegionsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const regions = await Region.find({ category: categoryId });
    res.status(200).json(regions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// REGION CONTROLLERS
export const createRegion = async (req, res) => {
  try {
    const { title, categoryId } = req.body;
    if (!categoryId) return res.status(400).json({ message: 'Category ID is required' });

    const newRegion = await Region.create({ title, category: categoryId });
    res.status(201).json(newRegion);
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'Region already exists' });
    res.status(500).json({ message: error.message });
  }
};

export const getAllRegions = async (req, res) => {
  try {
    const regions = await Region.find().populate('category', 'title');
    res.status(200).json(regions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateRegion = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedRegion = await Region.findByIdAndUpdate(id, req.body, { new: true });
    res.status(200).json(updatedRegion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteRegion = async (req, res) => {
  try {
    await Region.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Region deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getTraditionsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    // ১. চেক করুন Tradition মডেলটি ইমপোর্ট করা আছে কি না
    // ২. ফিল্টার করার লজিক ঠিক আছে কি না
    const traditions = await Tradition.find({ category: categoryId });

    res.status(200).json(traditions);
  } catch (error) {
    // এখানে সার্ভার কনসোলে এরর প্রিন্ট হবে, ওটা চেক করুন
    console.error('Error in getTraditionsByCategory:', error);
    res.status(500).json({ message: error.message });
  }
};

// TRADITION CONTROLLERS
export const createTradition = async (req, res) => {
  try {
    const { title, categoryId } = req.body;
    const newTradition = await Tradition.create({ title, category: categoryId });
    res.status(201).json(newTradition);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllTraditions = async (req, res) => {
  try {
    const traditions = await Tradition.find().populate('category', 'title');
    res.status(200).json(traditions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateTradition = async (req, res) => {
  try {
    const updated = await Tradition.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteTradition = async (req, res) => {
  try {
    await Tradition.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Tradition deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// CREATOR SPECIAL: GET EVERYTHING BY CATEGORY
export const getCategoryAssets = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const [tags, regions, traditions] = await Promise.all([
      Tag.find({ category: categoryId }),
      Region.find({ category: categoryId }),
      Tradition.find({ category: categoryId }),
    ]);

    res.status(200).json({
      success: true,
      tags,
      regions,
      traditions,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createTag = async (req, res) => {
  try {
    const { title, categoryId } = req.body;

    if (!categoryId) {
      return res.status(400).json({ message: 'Category ID is required to link this tag' });
    }

    const newTag = await Tag.create({
      title,
      category: categoryId,
    });

    await invalidateMetaCaches();

    res.status(201).json(newTag);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'This tag already exists in this category' });
    }
    res.status(500).json({ message: error.message });
  }
};

// ===== GET PAGE CONTENT (Public) =====
export const getPageContent = async (req, res) => {
  try {
    let content = await HowItWork.findOne({ pageName: 'how-it-works' });

    if (!content) {
      content = await HowItWork.create({ pageName: 'how-it-works' });
    }

    res.status(200).json({
      success: true,
      data: content,
    });
  } catch (error) {
    console.error('Get Page Content Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===== UPDATE FULL PAGE CONTENT (Admin) =====
export const updatePageContent = async (req, res) => {
  try {
    const { headerTitle, headerDescription, steps } = req.body;

    if (!headerTitle?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Header title is required',
      });
    }

    if (!headerDescription?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Header description is required',
      });
    }

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one step is required',
      });
    }

    for (const step of steps) {
      if (!step.title?.trim()) {
        return res.status(400).json({
          success: false,
          message: `Step ${step.id} title is required`,
        });
      }
      if (!step.description?.trim()) {
        return res.status(400).json({
          success: false,
          message: `Step ${step.id} description is required`,
        });
      }
    }

    const updatedContent = await HowItWork.findOneAndUpdate(
      { pageName: 'how-it-works' },
      {
        $set: {
          headerTitle: headerTitle.trim(),
          headerDescription: headerDescription.trim(),
          steps: steps.map((step, index) => ({
            id: step.id || index + 1,
            title: step.title.trim(),
            description: step.description.trim(),
          })),
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: 'Content saved successfully',
      data: updatedContent,
    });
  } catch (error) {
    console.error('Update Page Content Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===== ADD NEW STEP =====
export const addStep = async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Step title is required',
      });
    }

    const content = await HowItWork.findOne({ pageName: 'how-it-works' });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
      });
    }

    const newId = content.steps.length > 0 ? Math.max(...content.steps.map((s) => s.id)) + 1 : 1;

    content.steps.push({
      id: newId,
      title: title.trim(),
      description: description?.trim() || '',
    });

    await content.save();

    res.status(201).json({
      success: true,
      message: 'Step added successfully',
      data: content,
    });
  } catch (error) {
    console.error('Add Step Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===== UPDATE SINGLE STEP =====
export const updateSingleStep = async (req, res) => {
  try {
    const { stepId } = req.params;
    const { title, description } = req.body;

    const content = await HowItWork.findOne({ pageName: 'how-it-works' });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
      });
    }

    const stepIndex = content.steps.findIndex((s) => s.id === parseInt(stepId));

    if (stepIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Step not found',
      });
    }

    if (title !== undefined) {
      content.steps[stepIndex].title = title.trim();
    }
    if (description !== undefined) {
      content.steps[stepIndex].description = description.trim();
    }

    await content.save();

    res.status(200).json({
      success: true,
      message: 'Step updated successfully',
      data: content,
    });
  } catch (error) {
    console.error('Update Single Step Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===== DELETE STEP =====
export const deleteStep = async (req, res) => {
  try {
    const { stepId } = req.params;

    const content = await HowItWork.findOne({ pageName: 'how-it-works' });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
      });
    }

    content.steps = content.steps.filter((s) => s.id !== parseInt(stepId));

    // Re-assign IDs
    content.steps = content.steps.map((step, index) => ({
      ...step,
      id: index + 1,
    }));

    await content.save();

    res.status(200).json({
      success: true,
      message: 'Step deleted successfully',
      data: content,
    });
  } catch (error) {
    console.error('Delete Step Error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const pinListing = async (req, res) => {
  try {
    const { id } = req.params;
    const { position, categoryId } = req.body; // position: 1, 2, 3, or 4

    // ১. ওই ক্যাটাগরিতে এই পজিশনে আগে কেউ পিন করা থাকলে তাকে সরিয়ে দিন (Conflict Management)
    await Listing.updateOne(
      {
        category: categoryId,
        'promotion.pinnedPosition': position,
      },
      { $set: { 'promotion.pinnedPosition': null } }
    );

    // ২. নতুন লিস্টিংটিকে ওই পজিশনে পিন করুন
    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      { $set: { 'promotion.pinnedPosition': position } },
      { new: true }
    );

    res
      .status(200)
      .json({ message: `Listing pinned to position ${position}`, data: updatedListing });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const unpinListing = async (req, res) => {
  try {
    const { id } = req.params;
    await Listing.findByIdAndUpdate(id, { $set: { 'promotion.pinnedPosition': null } });
    res.status(200).json({ message: 'Listing unpinned successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ order: 1 });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getTagsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const tags = await Tag.find({ category: categoryId });
    res.status(200).json(tags);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createCategory = async (req, res) => {
  try {
    const count = await Category.countDocuments();
    const category = await Category.create({
      title: req.body.title,
      order: count,
    });
    await invalidateMetaCaches();
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Category already exists' });
    }
    res.status(500).json({ message: error.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      { title },
      { new: true, runValidators: true }
    );
    if (!updatedCategory) return res.status(404).json({ message: 'Category not found' });
    await invalidateMetaCaches();
    res.status(200).json(updatedCategory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findByIdAndDelete(id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    await invalidateMetaCaches();
    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tag = await Tag.findById(id);

    if (!tag) return res.status(404).json({ message: 'Tag not found' });

    let updateData = { title: req.body.title };

    const updatedTag = await Tag.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    await invalidateMetaCaches();
    res.status(200).json(updatedTag);
  } catch (error) {
    console.error('Update Tag Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;
    const tag = await Tag.findById(id);

    if (!tag) return res.status(404).json({ message: 'Tag not found' });

    if (tag.image) {
      const relativePath = tag.image.startsWith('/') ? tag.image.slice(1) : tag.image;
      const imagePath = path.join(process.cwd(), relativePath);

      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.error('File deletion error:', err.message);
        }
      }
    }

    await Tag.findByIdAndDelete(id);
    await invalidateMetaCaches();
    res.status(200).json({ message: 'Tag and image deleted successfully' });
  } catch (error) {
    console.error('Delete operation failed:', error);
    res.status(500).json({ message: 'Server error during deletion' });
  }
};

// export const getAllUsers = async (req, res) => {
//   try {
//     // status ফিল্টারটি ডিকনস্ট্রাক্ট করা হয়েছে
//     const {
//       search = '',
//       role = 'all',
//       status = 'all',
//       timeRange = 'all',
//       page = 1,
//       limit = 20,
//     } = req.query;

//     let query = {};
//     const now = new Date();

//     // ১. সার্চ লজিক (Name, Email বা Username দিয়ে)
//     if (search) {
//       query.$or = [
//         { firstName: { $regex: search, $options: 'i' } },
//         { lastName: { $regex: search, $options: 'i' } },
//         { email: { $regex: search, $options: 'i' } },
//         { username: { $regex: search, $options: 'i' } },
//       ];
//     }

//     // ২. রোল ফিল্টারিং (Admin, Creator, User)
//     if (role !== 'all') {
//       query.role = role;
//     }

//     // ৩. স্ট্যাটাস ফিল্টারিং (Active, Blocked, Suspended) - এটি নতুন যোগ করা হয়েছে
//     if (status !== 'all') {
//       query.status = status;
//     }

//     // ৪. টাইম রেঞ্জ ফিল্টারিং (নতুন ইউজার কবে জয়েন করেছে)
//     if (timeRange !== 'all') {
//       let startDate = new Date();
//       if (timeRange === 'today') {
//         startDate.setHours(0, 0, 0, 0);
//       } else if (timeRange === 'week') {
//         startDate.setDate(now.getDate() - 7);
//       } else if (timeRange === 'month') {
//         startDate.setMonth(now.getMonth() - 1);
//       }
//       query.createdAt = { $gte: startDate };
//     }

//     // ৫. ডাটাবেস থেকে ডাটা আনা (প্যাজিনেশনসহ)
//     const users = await User.find(query)
//       .select('-password')
//       .sort({ createdAt: -1 })
//       .limit(Number(limit))
//       .skip((Number(page) - 1) * Number(limit))
//       .lean();

//     // ৬. টোটাল কাউন্ট (ফ্রন্টএন্ড প্যাজিনেশনের জন্য)
//     const totalUsers = await User.countDocuments(query);

//     res.status(200).json({
//       success: true,
//       users,
//       pagination: {
//         totalUsers,
//         totalPages: Math.ceil(totalUsers / limit),
//         currentPage: Number(page),
//       },
//     });
//   } catch (error) {
//     console.error('Get All Users Error:', error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

export const getCreatorRequests = async (req, res) => {
  try {
    const { search = '', timeRange = 'all', page = 1, limit = 10 } = req.query;

    // ১. বেসিক কুয়েরি (যারা ক্রিয়েটর হতে অ্যাপ্লাই করেছে এবং পেন্ডিং আছে)
    let query = {
      'creatorRequest.isApplied': true,
      'creatorRequest.status': 'pending',
      role: 'user',
    };

    const now = new Date();

    // ২. সার্চ লজিক (নাম বা ইমেইল দিয়ে খোঁজার জন্য)
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // ৩. টাইম ফিল্টার (কবে অ্যাপ্লাই করেছে)
    // নোট: আপনার মডেলে যদি appliedAt না থাকে তবে updatedAt ব্যবহার করা যেতে পারে
    if (timeRange !== 'all') {
      let startDate = new Date();
      if (timeRange === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (timeRange === 'week') {
        startDate.setDate(now.getDate() - 7);
      } else if (timeRange === 'month') {
        startDate.setMonth(now.getMonth() - 1);
      }
      query.updatedAt = { $gte: startDate };
    }

    // ৪. ডাটাবেস থেকে ডাটা আনা (প্যাজিনেশনসহ)
    const requests = await User.find(query)
      .select('-password')
      .sort({ updatedAt: -1 }) // লেটেস্ট রিকোয়েস্ট আগে দেখাবে
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // ৫. টোটাল রিকোয়েস্ট কাউন্ট
    const totalRequests = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      requests,
      pagination: {
        totalRequests,
        totalPages: Math.ceil(totalRequests / limit),
        currentPage: Number(page),
      },
    });
  } catch (error) {
    console.error('Get Creator Requests Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const approveCreator = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          role: 'creator',
          'creatorRequest.isApplied': false,
          'creatorRequest.status': 'approved',
          'creatorRequest.adminComment': 'Congratulations! Your creator account is approved.',
          'creatorRequest.rejectionReason': '',
        },
      },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });
    await invalidateUserProfileCaches({
      id: user._id,
      username: user.username,
      slug: user.slug,
    });
    res.status(200).json({ message: 'User is now a Creator', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const rejectCreator = async (req, res) => {
  try {
    const { userId } = req.params;
    // ফ্রন্টএন্ড থেকে আসা ডাইনামিক ডাটা
    const { reasonCode, reason, statusType } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          // রিকোয়েস্ট প্রসেস হয়ে গেলে isApplied ফলস করে দিচ্ছি
          'creatorRequest.isApplied': false,

          // statusType: 'rejected' অথবা 'needs_review'
          'creatorRequest.status': statusType || 'rejected',

          // মডেলে Enum ভ্যালু হিসেবে যাচ্ছে (যেমন: 'QUALITY_ISSUE')
          'creatorRequest.rejectionReason': reasonCode || '',

          // বিস্তারিত টেক্সট যা টেক্সট এরিয়া থেকে আসছে
          'creatorRequest.additionalReason': reason || '',

          // অটোমেটিক অ্যাডমিন কমেন্ট
          'creatorRequest.adminComment':
            statusType === 'needs_review'
              ? 'Action Required: Protocol flags detected. Update your profile as requested.'
              : 'Protocol Denial: Application rejected by the admin team.',
        },
      },
      { new: true, runValidators: true } // Validators true রাখা জরুরি কারণ rejectionReason একটি Enum
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'Node not found.' });
    await invalidateUserProfileCaches({
      id: user._id,
      username: user.username,
      slug: user.slug,
    });

    res.status(200).json({
      success: true,
      message: `Creator request finalized as ${statusType}`,
      user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { action } = req.query; // 'block' অথবা 'suspend'

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let newStatus = 'active';

    if (action === 'block') {
      newStatus = user.status === 'blocked' ? 'active' : 'blocked';
    } else if (action === 'suspend') {
      newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    }

    user.status = newStatus;
    await user.save();
    await invalidateUserProfileCaches({
      id: user._id,
      username: user.username,
      slug: user.slug,
    });

    res.status(200).json({
      success: true,
      message: `User status updated to ${newStatus}`,
      status: newStatus,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const manageListings = async (req, res) => {
  try {
    const listings = await Listing.find()
      .populate('creatorId', 'firstName lastName username email')
      .populate('category', 'title')
      .populate('culturalTags', 'title image')
      .sort({ createdAt: -1 })
      .lean();

    const now = new Date();

    const formattedListings = listings.map((item) => {
      const ppcBalance = item.promotion?.ppc?.isActive ? item.promotion.ppc.ppcBalance || 0 : 0;
      let boostRemaining = 'No Active Boost';

      if (item.promotion?.boost?.isActive && item.promotion?.boost?.expiresAt) {
        const expiresAt = new Date(item.promotion.boost.expiresAt);
        if (expiresAt > now) {
          const diffMs = expiresAt - now;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          boostRemaining = `${diffDays}d ${diffHours}h left`;
        } else {
          boostRemaining = 'Expired';
        }
      }

      return {
        ...item,
        creatorName: item.creatorId
          ? `${item.creatorId.firstName || ''} ${item.creatorId.lastName || ''}`.trim() ||
          item.creatorId.username
          : 'Unknown Creator',
        categoryName: item.category?.title || 'Uncategorized',
        ppcStatus: ppcBalance.toFixed(2),
        boostStatus: boostRemaining,
        isCurrentlyPromoted: item.isPromoted && (ppcBalance > 0 || boostRemaining.includes('left')),
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteListingByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findByIdAndDelete(id).select('_id slug creatorId');
    if (listing) {
      await invalidateListingCaches({
        id: listing._id,
        slug: listing.slug,
        creatorId: listing.creatorId,
      });
    }
    res.status(200).json({ message: 'Listing removed by admin' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateListingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reasonCode, additionalReason } = req.body;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    // ১. Immutable Block Logic
    if (listing.status === 'blocked') {
      return res.status(403).json({ message: 'Action Denied. This asset is permanently blocked.' });
    }

    // ২. Validation: রিজেক্ট বা ব্লক করলে reasonCode ম্যান্ডেটরি
    if ((status === 'rejected' || status === 'blocked') && !reasonCode) {
      return res
        .status(400)
        .json({ message: 'A specific reason code must be selected for this action.' });
    }

    // ৩. Status Update
    listing.status = status;

    // ৪. Moderation Action Logic
    if (status === 'rejected' || status === 'blocked') {
      listing.rejectionReason = reasonCode;
      listing.additionalReason = additionalReason || '';

      // Kill Promotion (টাকা দিয়ে প্রোমোট করলেও রুলস ব্রেক করলে সুবিধা বন্ধ)
      listing.promotion.isPromoted = false;
      listing.promotion.level = 0;
      listing.promotion.boost.isActive = false;
      listing.promotion.ppc.isActive = false;
    }

    // ৫. Approval Logic (রিজন ক্লিন করা)
    if (status === 'approved') {
      listing.rejectionReason = '';
      listing.additionalReason = '';
    }

    await listing.save();
    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    res.status(200).json({
      success: true,
      message: `Listing ${status} successfully`,
      data: { status, reasonCode },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategoryOrder = async (req, res) => {
  try {
    const { categories } = req.body;

    const updatePromises = categories.map((cat, index) => {
      return Category.findByIdAndUpdate(cat._id, { order: index });
    });

    await Promise.all(updatePromises);
    await invalidateMetaCaches();

    res.status(200).json({ message: 'Order updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const {
      search = '',
      role = 'all',
      status = 'all',
      dateFrom = '',
      dateTo = '',
      page = 1,
      limit = 20,
    } = req.query;

    let query = {};

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
      ];
    }

    if (role !== 'all') query.role = role;
    if (status !== 'all') query.status = status;

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip((Number(page) - 1) * Number(limit))
        .lean(),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      users,
      pagination: {
        totalUsers,
        totalPages: Math.ceil(totalUsers / Number(limit)),
        currentPage: Number(page),
      },
    });
  } catch (error) {
    console.error('Get All Users Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// exportUsersExcel
export const exportUsersExcel = async (req, res) => {
  try {
    const { role, status, dateFrom, dateTo, search } = req.query;

    const filter = {};
    if (role && role !== 'all') filter.role = role;
    if (status && status !== 'all') filter.status = status;
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
      ];
    }

    const userCursor = User.find(filter).select('-password').cursor();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users Export');

    worksheet.columns = [
      { header: 'ID', key: '_id', width: 26 },
      { header: 'FIRST NAME', key: 'firstName', width: 18 },
      { header: 'LAST NAME', key: 'lastName', width: 18 },
      { header: 'BUSINESS NAME', key: 'businessName', width: 24 },
      { header: 'EMAIL', key: 'email', width: 32 },
      { header: 'USERNAME', key: 'username', width: 20 },
      { header: 'ROLE', key: 'role', width: 12 },
      { header: 'STATUS', key: 'status', width: 14 },
      { header: 'COUNTRY', key: 'country', width: 16 },
      { header: 'CITY', key: 'city', width: 16 },
      { header: 'WEBSITE', key: 'websiteLink', width: 28 },
      { header: 'EMAIL VERIFIED', key: 'isEmailVerified', width: 16 },
      { header: 'WALLET BALANCE', key: 'walletBalance', width: 16 },
      { header: 'LISTINGS COUNT', key: 'listingsCount', width: 16 },
      { header: 'JOIN DATE', key: 'createdAt', width: 20 },
    ];

    // Header style
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    for (let user = await userCursor.next(); user != null; user = await userCursor.next()) {
      const row = worksheet.addRow({
        _id: user._id.toString(),
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        businessName: user.profile?.businessName || '',
        email: user.email || '',
        username: user.username || '',
        role: (user.role || 'user').toUpperCase(),
        status: (user.status || 'active').toUpperCase(),
        country: user.profile?.country || '',
        city: user.profile?.city || '',
        websiteLink: user.profile?.websiteLink || '',
        isEmailVerified: user.isEmailVerified ? 'YES' : 'NO',
        walletBalance: user.walletBalance ?? 0,
        listingsCount: user.listingsCount ?? 0,
        createdAt: user.createdAt ? user.createdAt.toISOString().split('T')[0] : '',
      });

      // Alternate row color
      if (row.number % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8F5' } };
      }
    }

    // Auto-filter
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length },
    };

    const fileName = `WCM_Users_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
  }
};

// export const exportUsersExcel = async (req, res) => {
//   try {
//     // 🔍 শুধুমাত্র যাদের রোল 'creator' তাদের ফিল্টার করুন
//     const userCursor = User.find({ role: 'creator' }).select('-password').cursor();

//     const workbook = new ExcelJS.Workbook();
//     const worksheet = workbook.addWorksheet('System Creators List');

//     // কালার কোড এবং হেডার (SaaS Style)
//     worksheet.columns = [
//       { header: 'ID', key: '_id', width: 25 },
//       { header: 'FULL NAME', key: 'fullName', width: 25 },
//       { header: 'BUSINESS NAME', key: 'businessName', width: 25 }, // নতুন অ্যাড করা হয়েছে
//       { header: 'EMAIL', key: 'email', width: 30 },
//       { header: 'USERNAME', key: 'username', width: 20 },
//       { header: 'STATUS', key: 'status', width: 12 },
//       { header: 'COUNTRY', key: 'country', width: 15 },
//       { header: 'JOIN DATE', key: 'createdAt', width: 20 },
//     ];

//     // হেডার স্টাইল (Orange Theme)
//     worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
//     worksheet.getRow(1).fill = {
//       type: 'pattern',
//       pattern: 'solid',
//       fgColor: { argb: 'FFEA580C' },
//     };

//     for (let user = await userCursor.next(); user != null; user = await userCursor.next()) {
//       const profile = user.profile || {};

//       worksheet.addRow({
//         _id: user._id.toString(),
//         fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A',
//         businessName: profile.businessName || 'N/A', // আপনার স্কিমা অনুযায়ী
//         email: user.email || 'N/A',
//         username: user.username || 'N/A',
//         status: (user.status || 'active').toUpperCase(),
//         country: profile.country || 'N/A',
//         createdAt: user.createdAt ? user.createdAt.toISOString().split('T')[0] : 'N/A',
//       });
//     }

//     const fileName = `WCM_Creators_List_${new Date().toISOString().split('T')[0]}.xlsx`;

//     res.setHeader(
//       'Content-Type',
//       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//     );
//     res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

//     await workbook.xlsx.write(res);
//     return res.end();
//   } catch (error) {
//     console.error('EXPORT ERROR:', error);
//     if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
//   }
// };

export const exportTransactionsExcel = async (req, res) => {
  try {
    // শুধুমাত্র সফল ট্রানজ্যাকশনগুলো নিলে রিপোর্ট ক্লিন থাকে, চাইলে {} রাখতে পারেন
    const transactionCursor = Transaction.find({ status: 'succeeded' })
      .populate('creator', 'firstName lastName email username')
      .populate('listing', 'title')
      .sort({ createdAt: -1 })
      .cursor();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payment Report');

    worksheet.columns = [
      { header: 'DATE', key: 'createdAt', width: 15 },
      { header: 'INVOICE NO', key: 'invoiceNumber', width: 20 },
      { header: 'CREATOR', key: 'creatorName', width: 25 },
      { header: 'LISTING', key: 'listingTitle', width: 30 },
      { header: 'PACKAGE', key: 'packageType', width: 12 },
      { header: 'CURRENCY', key: 'currency', width: 10 },
      { header: 'AMOUNT PAID', key: 'amountPaid', width: 15 },
      { header: 'EUR (NET)', key: 'amountInEUR', width: 15 },
      { header: 'VAT (19%)', key: 'vatAmount', width: 15 },
      { header: 'STRIPE ID', key: 'stripeSessionId', width: 30 },
    ];

    // Header Styling (Your Orange Theme)
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEA580C' },
    };

    let totalRevenueEUR = 0;

    for (let tx = await transactionCursor.next(); tx != null; tx = await transactionCursor.next()) {
      const eurVal = Number(tx.amountInEUR || 0);
      const vatVal = Number(tx.vatAmount || 0);

      worksheet.addRow({
        createdAt: tx.createdAt ? tx.createdAt.toISOString().split('T')[0] : 'N/A',
        invoiceNumber: tx.invoiceNumber || 'N/A',
        creatorName: tx.creator
          ? `${tx.creator.firstName || ''} ${tx.creator.lastName || ''}`.trim()
          : 'N/A',
        listingTitle: tx.listing ? tx.listing.title : 'N/A',
        packageType: (tx.packageType || '').toUpperCase(),
        currency: (tx.currency || '').toUpperCase(),
        amountPaid: tx.amountPaid, // Number format for Excel formulas
        amountInEUR: eurVal,
        vatAmount: vatVal,
        stripeSessionId: tx.stripeSessionId,
      });

      totalRevenueEUR += eurVal;
    }

    // --- Footer: Total Revenue Row ---
    const totalRow = worksheet.addRow({
      listingTitle: 'TOTAL REVENUE (EUR)',
      amountInEUR: totalRevenueEUR,
    });
    totalRow.font = { bold: true };
    totalRow.getCell('amountInEUR').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0FDF4' }, // Light green background
    };

    const fileName = `Payment_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('TRANSACTION EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Export failed' });
  }
};

export const getAllTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', filter = 'all', userId } = req.query;

    let query = { status: 'completed' };

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      query.creator = userId;
    }

    const now = new Date();
    if (filter === 'today') {
      query.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
    } else if (filter === 'month') {
      query.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
    } else if (filter === 'year') {
      query.createdAt = { $gte: new Date(now.getFullYear(), 0, 1) };
    }

    if (search) {
      const users = await User.find({
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');

      query.$and = [
        { ...query }, // আগের ফিল্টারগুলো বজায় রাখা
        {
          $or: [
            { invoiceNumber: { $regex: search, $options: 'i' } },
            { packageType: { $regex: search, $options: 'i' } },
            { stripeSessionId: { $regex: search, $options: 'i' } },
            { creator: { $in: users.map((u) => u._id) } },
          ],
        },
      ];
    }

    const transactions = await Transaction.find(query)
      .populate('creator', 'firstName lastName email username')
      .populate('listing', 'title')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      transactions, // এখানে সরাসরি ডাটাবেজ অবজেক্ট পাঠাচ্ছি
      pagination: {
        totalCount: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number(page),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const exportTransactionsByRange = async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;

    let query = { status: 'completed' };

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(new Date(startDate).setHours(0, 0, 0, 0)),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
      };
    }

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      query.creator = userId;
    }

    const transactions = await Transaction.find(query)
      .populate('creator', 'firstName lastName email')
      .populate('listing', 'title')
      .sort({ createdAt: -1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Custom Payment Report');

    worksheet.columns = [
      { header: 'DATE', key: 'date', width: 15 },
      { header: 'INVOICE', key: 'invoice', width: 20 },
      { header: 'CREATOR', key: 'creator', width: 25 },
      { header: 'PACKAGE', key: 'package', width: 15 },
      { header: 'EUR (NET)', key: 'amount', width: 15 },
      { header: 'VAT', key: 'vat', width: 10 },
    ];

    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };

    transactions.forEach((tx) => {
      worksheet.addRow({
        date: tx.createdAt.toISOString().split('T')[0],
        invoice: tx.invoiceNumber,
        creator: `${tx.creator?.firstName} ${tx.creator?.lastName}`,
        package: tx.packageType.toUpperCase(),
        amount: tx.amountInEUR,
        vat: tx.vatAmount,
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Transactions_${startDate}_to_${endDate}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: 'Export failed' });
  }
};

export const updatePpcBalanceManual = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountToAdd } = req.body;

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const currentBalance = Number(listing.promotion?.ppc?.ppcBalance) || 0;
    const newBalance = currentBalance + Number(amountToAdd);

    listing.promotion.ppc.ppcBalance = newBalance;
    listing.promotion.ppc.isActive = newBalance > 0;
    listing.isPromoted = true;

    await listing.save();
    await invalidateListingCaches({
      id: listing._id,
      slug: listing.slug,
      creatorId: listing.creatorId,
    });

    res.status(200).json({
      success: true,
      message: `Successfully added €${amountToAdd}. New balance: €${newBalance}`,
      newBalance,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPromotedListings = async (req, res) => {
  try {
    const {
      search = '',
      type = 'all', // 'all', 'boost', 'ppc', 'blocked'
      page = 1,
      limit = 10,
      timeRange = 'all',
    } = req.query;

    const now = new Date();
    let query = {};

    // ১. টাইম রেঞ্জ ফিল্টার
    if (timeRange !== 'all') {
      let startDate = new Date();
      if (timeRange === 'today') startDate.setHours(0, 0, 0, 0);
      else if (timeRange === 'week') startDate.setDate(now.getDate() - 7);
      else if (timeRange === 'month') startDate.setMonth(now.getMonth() - 1);

      query.updatedAt = { $gte: startDate };
    }

    // ২. প্রোমোশন এবং স্ট্যাটাস লজিক
    const boostQuery = {
      'promotion.boost.isActive': true,
      'promotion.boost.expiresAt': { $gt: now },
      status: 'approved', // বুস্টের জন্য অবশ্যই অ্যাপ্রুভড হতে হবে
    };

    const ppcQuery = {
      'promotion.ppc.isActive': true,
      'promotion.ppc.ppcBalance': { $gt: 0 },
      status: 'approved', // PPC এর জন্য অবশ্যই অ্যাপ্রুভড হতে হবে
    };

    if (type === 'boost') {
      query = { ...query, ...boostQuery };
    } else if (type === 'ppc') {
      query = { ...query, ...ppcQuery };
    } else if (type === 'blocked') {
      // শুধুমাত্র ব্লকড লিস্টিং দেখাবে
      query.status = 'blocked';
    } else {
      // 'all' এর জন্য: হয় বুস্ট একটিভ, অথবা PPC একটিভ (এবং লিস্টিং ব্লকড নয়)
      query.$or = [boostQuery, ppcQuery];
    }

    // ৩. সার্চ লজিক (Title বা Creator Email/Username দিয়ে সার্চ করা যাবে)
    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { 'creatorId.email': { $regex: search, $options: 'i' } },
        ],
      });
    }

    // ৪. ডাটা ফেচিং
    const listings = await Listing.find(query)
      .populate('creatorId', 'firstName lastName email username')
      .sort({ 'promotion.level': -1, updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await Listing.countDocuments(query);

    // ৫. ডাটা ফরম্যাটিং এবং ট্রানজেকশন সিঙ্ক
    const formattedData = await Promise.all(
      listings.map(async (item) => {
        // লিস্টিং এর শেষ সফল ট্রানজেকশন খুঁজে বের করা
        const lastTransaction = await Transaction.findOne({
          listing: item._id,
          status: 'completed',
        })
          .sort({ createdAt: -1 })
          .select('_id invoiceNumber');

        const isBoost = item.promotion.boost.isActive && item.promotion.boost.expiresAt > now;
        const isPpc = item.promotion.ppc.isActive && item.promotion.ppc.ppcBalance > 0;

        return {
          _id: item._id,
          title: item.title,
          status: item.status, // Frontend-এ ব্যাজ দেখানোর জন্য
          rejectionReason: item.rejectionReason || '', // ব্লক হওয়ার কারণ
          creatorName: `${item.creatorId?.firstName || 'Unknown'} ${item.creatorId?.lastName || ''}`,
          creatorEmail: item.creatorId?.email || 'N/A',
          boostStatus: isBoost
            ? `Expires: ${new Date(item.promotion.boost.expiresAt).toLocaleDateString()}`
            : 'Inactive',
          ppcBalance: `€${(item.promotion.ppc.ppcBalance || 0).toFixed(2)}`,
          promotionLevel: item.promotion.level,
          activeType:
            item.status === 'blocked'
              ? 'Blocked'
              : isBoost && isPpc
                ? 'Both'
                : isBoost
                  ? 'Boost'
                  : isPpc
                    ? 'PPC'
                    : 'None',
          invoiceId: lastTransaction ? lastTransaction._id : null,
          invoiceNo: lastTransaction ? lastTransaction.invoiceNumber : 'N/A',
        };
      })
    );

    res.status(200).json({
      success: true,
      listings: formattedData,
      totalCount: count,
      totalPages: Math.ceil(count / limit),
      currentPage: Number(page),
    });
  } catch (error) {
    console.error('Get Promoted Listings Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminStats = async (req, res) => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const [
      totalCreators,
      pendingListings,
      pendingRequests,
      recentPaymentsCount,
      allSuccessfulTopups,
      globalAnalytics,
      siteTraffic,
      auditTotals,
    ] = await Promise.all([
      User.countDocuments({ role: 'creator' }),
      Listing.countDocuments({ status: 'pending' }),
      User.countDocuments({ 'creatorRequest.isApplied': true, 'creatorRequest.status': 'pending' }),
      Transaction.countDocuments({
        packageType: 'wallet_topup',
        status: 'completed',
        createdAt: { $gte: twentyFourHoursAgo },
      }),
      Transaction.find({ packageType: 'wallet_topup', status: 'completed' }).lean(),
      Analytics.aggregate([
        { $group: { _id: null, totalViews: { $sum: '$views' }, totalClicks: { $sum: '$clicks' } } },
      ]),
      Visitor.aggregate([
        {
          $group: {
            _id: null,
            totalSiteViews: { $sum: '$visitCount' },
            uniqueVisitors: { $count: {} },
          },
        },
      ]),
      AuditLog.aggregate([
        { $match: { action: { $in: ['PPC_CLICK_DEDUCTION', 'BOOST_DAILY_EARNED'] } } },
        { $project: { rawAmount: { $ifNull: ['$details.costDeducted', '$details.earnedAmount'] } } },
        { $project: { amount: { $toDouble: { $arrayElemAt: [{ $split: ['$rawAmount', ' '] }, 0] } } } },
        { $group: { _id: null, totalEarned: { $sum: '$amount' } } },
      ]),
    ]);

    // ১. Financial Calculation
    let totalRevenue = 0;
    let totalVat = 0;
    let totalStripeFees = 0;

    allSuccessfulTopups.forEach((t) => {
      const amountEUR = Number(t.amountInEUR) || 0;
      totalRevenue += amountEUR;
      totalVat += Number(t.vatAmount) || 0;

      const stripeFee = t.currency !== 'EUR'
        ? amountEUR * 0.0573
        : amountEUR * 0.0373;

      totalStripeFees += Number(stripeFee.toFixed(2));
    });

    // ২. Net Profit
    const netProfit = totalRevenue - totalStripeFees;

    // ৩. Net Earned Revenue
    const netEarnedRevenue = auditTotals[0]?.totalEarned || 0;

    // ৪. Active Promotions Count
    const activePromotionsCount = await Listing.countDocuments({
      $or: [
        { 'promotion.boost.isActive': true, 'promotion.boost.expiresAt': { $gt: now } },
        { 'promotion.ppc.isActive': true, 'promotion.ppc.ppcBalance': { $gt: 0 } },
      ],
    });

    // ৫. Chart Data
    const dailyData = await Transaction.aggregate([
      {
        $match: {
          packageType: 'wallet_topup',
          status: 'completed',
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$amountInEUR' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const revenueFlow = dailyData.map((d) => {
      const dailyRev = d.revenue || 0;
      const dailyFee = dailyRev * 0.0373;
      return {
        date: d._id,
        revenue: Number(dailyRev.toFixed(2)),
        profit: Number(Math.max(0, dailyRev - dailyFee).toFixed(2)),
      };
    });

    res.status(200).json({
      success: true,
      cards: {
        totalRevenue: totalRevenue.toFixed(2),
        netEarnedRevenue: netEarnedRevenue.toFixed(2),
        netProfit: netProfit.toFixed(2),
        stripeFees: totalStripeFees.toFixed(2),
        totalVat: totalVat.toFixed(2),
        activePromotions: activePromotionsCount,
        recentPayments: recentPaymentsCount,
        totalSiteViews: siteTraffic[0]?.totalSiteViews || 0,
        uniqueVisitors: siteTraffic[0]?.uniqueVisitors || 0,
        totalViews: globalAnalytics[0]?.totalViews || 0,
        totalClicks: globalAnalytics[0]?.totalClicks || 0,
        pendingListings,
        pendingCreatorRequests: pendingRequests,
        totalCreators,
      },
      charts: { revenueFlow },
    });
  } catch (error) {
    console.error('Admin Stats Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // ১. ইউজারের মেইন ডাটা এবং ক্যাটাগরি পপুলেট করা
    const user = await User.findById(id)
      .select('-password') // সিকিউরিটির জন্য পাসওয়ার্ড বাদ
      .populate('profile.category', 'title') // প্রোফাইলের ক্যাটাগরি নাম আনা
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'ENTITY_NOT_FOUND: Protocol identification failed.',
      });
    }

    // ২. ইউজারের লিস্টিং মেট্রিক্স আনা (অ্যাডমিন প্যানেলে দেখানোর জন্য)
    // এখানে আমরা দেখবো ইউজারের কয়টি লিস্টিং আছে এবং কয়টি প্রোমোটেড
    const listings = await Listing.find({ creatorId: id }).lean();

    const stats = {
      totalListings: listings.length,
      activeListings: listings.filter((l) => l.status === 'approved').length,
      pendingListings: listings.filter((l) => l.status === 'pending').length,
      promotedListings: listings.filter((l) => l.promotion?.isPromoted).length,
      totalViews: listings.reduce((acc, curr) => acc + (curr.views || 0), 0),
    };

    // ৩. ইউজারের ফুল প্রোফাইল কমপ্লিটনেস চেক (অপশনাল কিন্তু অ্যাডমিনের জন্য হেল্পফুল)
    const profileCompleteness = {
      hasVat: !!user.profile?.vatNumber,
      isVerified: user.status === 'active',
      hasBio: !!user.profile?.bio,
      hasImage: !!user.profile?.profileImage,
    };

    res.status(200).json({
      success: true,
      user: {
        ...user,
        metrics: stats, // এই ডাটাগুলো আপনার MetricCard এ বসবে
        compliance: profileCompleteness,
      },
    });
  } catch (error) {
    console.error('CRITICAL_AUTH_ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'CORE_RETRIEVAL_FAILURE: ' + error.message,
    });
  }
};



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'backups');

export const getBackupList = async (req, res) => {
  try {
    if (!fs.existsSync(PUBLIC_DIR)) {
      return res.status(200).json([]);
    }

    const files = fs.readdirSync(PUBLIC_DIR);

    const backupList = files
      .filter((file) => file.endsWith('.gzip'))
      .map((file) => {
        const stats = fs.statSync(path.join(PUBLIC_DIR, file));
        return {
          fileName: file,
          size: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
          createdAt: stats.birthtime,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt); // নতুন ফাইল উপরে থাকবে

    return res.status(200).json(backupList);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleManualBackup = async (req, res) => {
  try {
    const result = await backupDB();
    return res.status(200).json({ success: true, message: `Backup created: ${result.fileName}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleManualRestore = async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ success: false, message: 'File name required' });

    await restoreDB(fileName);
    return res.status(200).json({ success: true, message: 'Database clean-merged successfully!' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBackupFile = async (req, res) => {
  try {
    const { fileName } = req.params;
    const filePath = path.join(PUBLIC_DIR, fileName);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.status(200).json({ success: true, message: 'Backup file deleted permanently.' });
    } else {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};