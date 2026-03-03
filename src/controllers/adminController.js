import User from '../models/User.js';
import Listing from '../models/Listing.js';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import Transaction from '../models/Transaction.js';
import Analytics from '../models/Analytics.js';

export const createTag = async (req, res) => {
  try {
    const { title } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a tag icon/image' });
    }

    const imageUrl = req.file.path;

    const newTag = await Tag.create({
      title,
      image: imageUrl,
    });

    res.status(201).json(newTag);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Tag title already exists' });
    }

    console.error('Tag Creation Error:', error);
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

    if (req.file) {
      if (tag.image && !tag.image.startsWith('http')) {
        const oldImagePath = path.join(process.cwd(), tag.image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (err) {
            console.error('Old local tag image delete failed:', err);
          }
        }
      }

      updateData.image = req.file.path;
    }

    const updatedTag = await Tag.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

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
    res.status(200).json({ message: 'Tag and image deleted successfully' });
  } catch (error) {
    console.error('Delete operation failed:', error);
    res.status(500).json({ message: 'Server error during deletion' });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCreatorRequests = async (req, res) => {
  try {
    const requests = await User.find({
      'creatorRequest.isApplied': true,
      'creatorRequest.status': 'pending',
      role: 'user',
    }).select('-password');

    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
    res.status(200).json({ message: 'User is now a Creator', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const rejectCreator = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, statusType } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          'creatorRequest.isApplied': false,

          'creatorRequest.status': statusType || 'rejected',

          'creatorRequest.rejectionReason': reason || 'No specific reason provided.',

          'creatorRequest.adminComment':
            statusType === 'needs_review'
              ? 'Action required: Please update your profile as requested.'
              : 'Final Decision: Application Rejected.',
        },
      },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({
      message: `Creator request processed as ${statusType}`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ message: 'Cannot block an admin' });

    user.status = user.status === 'active' ? 'blocked' : 'active';
    await user.save();

    res.status(200).json({ message: `User is now ${user.status}`, status: user.status });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
      // PPC Balance calculation
      const ppcBalance = item.promotion?.ppc?.isActive ? (item.promotion.ppc.ppcBalance || 0) : 0;

      // Boost Remaining Time calculation
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
          ? `${item.creatorId.firstName || ''} ${item.creatorId.lastName || ''}`.trim() || item.creatorId.username
          : 'Unknown Creator',
        categoryName: item.category?.title || 'Uncategorized',
        ppcStatus: ppcBalance.toFixed(2),
        boostStatus: boostRemaining,
        isCurrentlyPromoted: item.isPromoted && (ppcBalance > 0 || boostRemaining.includes('left'))
      };
    });

    res.status(200).json(formattedListings);
  } catch (error) {
    console.error('Admin Manage Listings Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const deleteListingByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    await Listing.findByIdAndDelete(id);
    res.status(200).json({ message: 'Listing removed by admin' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateListingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body; 

    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    listing.status = status;
    if (status === 'rejected') {
      listing.rejectionReason = rejectionReason || 'Does not follow community guidelines.';
      listing.isPromoted = false; 
    }

    await listing.save();
    res.status(200).json({ success: true, message: `Listing ${status} successfully.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const exportUsersExcel = async (req, res) => {
  try {
    const userCursor = User.find({}).select('-password').cursor();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('System All Users');

    worksheet.columns = [
      { header: 'ID', key: '_id', width: 25 },
      { header: 'FULL NAME', key: 'fullName', width: 25 },
      { header: 'EMAIL', key: 'email', width: 30 },
      { header: 'USERNAME', key: 'username', width: 20 },
      { header: 'ROLE', key: 'role', width: 12 },
      { header: 'STATUS', key: 'status', width: 12 },
      { header: 'COUNTRY', key: 'country', width: 15 },
      { header: 'CREATOR STATUS', key: 'creatorStatus', width: 15 },
      { header: 'JOIN DATE', key: 'createdAt', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEA580C' },
    };

    let count = 0;

    for (let user = await userCursor.next(); user != null; user = await userCursor.next()) {
      const profile = user.profile || {};
      const creatorRequest = user.creatorRequest || {};

      worksheet.addRow({
        _id: user._id.toString(),
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A',
        email: user.email || 'N/A',
        username: user.username || 'N/A',
        role: (user.role || 'user').toUpperCase(),
        status: (user.status || 'active').toUpperCase(),
        country: profile.country || 'N/A',
        creatorStatus: creatorRequest.isApplied
          ? (creatorRequest.status || 'pending').toUpperCase()
          : 'NO REQUEST',
        createdAt: user.createdAt ? user.createdAt.toISOString().split('T')[0] : 'N/A',
      });
      count++;
    }

    console.log(`Exported ${count} users to Excel.`);

    const fileName = `WCM_All_Users_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    return res.status(200).end();
  } catch (error) {
    console.error('EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).send('Export failed');
  }
};

export const getAdminStats = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const now = new Date();

    const [
      totalUsers, 
      totalCreators, 
      totalListings, 
      pendingListings,
      pendingRequests,
      transactions,
      activePpcCampaigns,
      activeBoostCampaigns
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'creator' }),
      Listing.countDocuments(),
      Listing.countDocuments({ status: 'pending' }),
      User.countDocuments({ 'creatorRequest.status': 'pending', 'creatorRequest.isApplied': true }),
      Transaction.find({ status: 'completed' }),
      Listing.countDocuments({ 
        'promotion.ppc.isActive': true, 
        'promotion.ppc.ppcBalance': { $gt: 0 } 
      }),
      Listing.countDocuments({ 
        'promotion.boost.isActive': true, 
        'promotion.boost.expiresAt': { $gt: now } 
      }),
    ]);

    const totalRevenue = transactions.reduce((acc, curr) => acc + (curr.amountPaid || 0), 0);
    const ppcRevenue = transactions
      .filter(t => t.packageType === 'ppc')
      .reduce((acc, curr) => acc + (curr.amountPaid || 0), 0);
    const boostRevenue = transactions
      .filter(t => t.packageType === 'boost')
      .reduce((acc, curr) => acc + (curr.amountPaid || 0), 0);

    const categoryDist = await Listing.aggregate([
      {
        $group: {
          _id: "$category",
          value: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "categories", 
          localField: "_id",
          foreignField: "_id",
          as: "catDetails"
        }
      },
      { $unwind: "$catDetails" },
      {
        $project: {
          _id: 0,
          name: "$catDetails.title",
          value: 1
        }
      }
    ]);

    const dailyStats = await Transaction.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo }, status: 'completed' } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$amountPaid" }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    const userGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          newUsers: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    const topPromotedListings = await Listing.find({ isPromoted: true })
      .sort({ 'promotion.level': -1 })
      .limit(5)
      .select('title promotion.level promotion.ppc.isActive promotion.boost.isActive')
      .lean();

    res.status(200).json({
      success: true,
      cards: {
        totalRevenue: totalRevenue.toFixed(2),
        ppcRevenue: ppcRevenue.toFixed(2),
        boostRevenue: boostRevenue.toFixed(2),
        totalUsers,
        totalCreators,
        totalListings,
        pendingListings,
        pendingRequests,
        activeCampaigns: activePpcCampaigns + activeBoostCampaigns,
        activePpc: activePpcCampaigns,
        activeBoost: activeBoostCampaigns
      },
      charts: {
        categories: categoryDist,
        revenueAndUsers: dailyStats.map(ds => {
          const userEntry = userGrowth.find(ug => ug._id === ds._id);
          return {
            date: ds._id,
            revenue: ds.revenue,
            users: userEntry ? userEntry.newUsers : 0
          };
        }),
        topPromoted: topPromotedListings.map(l => ({
          name: l.title.substring(0, 15) + '...',
          score: l.promotion.level,
          type: l.promotion.ppc?.isActive ? 'PPC' : 'Boost'
        }))
      }
    });
  } catch (error) {
    console.error('Admin Stats Error:', error);
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

    res.status(200).json({ message: 'Order updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const exportTransactionsExcel = async (req, res) => {
  try {
    const transactionCursor = Transaction.find({})
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
      { header: 'FX RATE', key: 'fxRate', width: 10 },
      { header: 'EUR (INTERNAL)', key: 'amountInEUR', width: 15 },
      { header: 'VAT (19% EUR)', key: 'vatAmount', width: 15 },
      { header: 'STRIPE ID', key: 'stripeSessionId', width: 30 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEA580C' },
    };

    let count = 0;

    for (let tx = await transactionCursor.next(); tx != null; tx = await transactionCursor.next()) {
      worksheet.addRow({
        createdAt: tx.createdAt ? tx.createdAt.toISOString().split('T')[0] : 'N/A',
        invoiceNumber: tx.invoiceNumber || 'N/A',
        creatorName: tx.creator
          ? `${tx.creator.firstName || ''} ${tx.creator.lastName || ''}`.trim()
          : 'N/A',
        listingTitle: tx.listing ? tx.listing.title : 'Deleted Listing',
        packageType: (tx.packageType || '').toUpperCase(),
        currency: (tx.currency || '').toUpperCase(),
        amountPaid: tx.amountPaid,
        fxRate: tx.fxRate,
        amountInEUR: tx.amountInEUR.toFixed(2),
        vatAmount: tx.vatAmount.toFixed(2),
        stripeSessionId: tx.stripeSessionId,
      });
      count++;
    }

    console.log(`Exported ${count} transactions to Excel.`);

    const fileName = `Payment_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    return res.status(200).end();
  } catch (error) {
    console.error('TRANSACTION EXPORT ERROR:', error);
    if (!res.headersSent) res.status(500).send('Export failed');
  }
};

export const getAllTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    
    let query = { status: 'completed' };
    
    const transactions = await Transaction.find(query)
      .populate('creator', 'firstName lastName email')
      .populate('listing', 'title')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalCount: count
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    res.status(200).json({ 
      success: true, 
      message: `Successfully added €${amountToAdd}. New balance: €${newBalance}`,
      newBalance 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};