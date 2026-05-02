import express from 'express';
import {
  getAllUsers,
  getCreatorRequests,
  approveCreator,
  rejectCreator,
  toggleUserStatus,
  manageListings,
  updateListingStatus,
  pinListing,           // পিন কন্ট্রোলার ইম্পোর্ট নিশ্চিত করা হয়েছে
  unpinListing,         // আনপিন কন্ট্রোলার ইম্পোর্ট নিশ্চিত করা হয়েছে
  createTag,
  createCategory,
  updateCategory,
  deleteCategory,
  updateTag,
  deleteTag,
  exportUsersExcel,
  getAdminStats,
  updateCategoryOrder,
  getAllTransactions,
  exportTransactionsExcel,
  updatePpcBalanceManual,
  getPromotedListings,
  getTagsByCategory,
  getAllCategories,
  getUserById,
  exportTransactionsByRange,
  // --- Regions Controllers ---
  getAllRegions,
  getRegionsByCategory,
  createRegion,
  updateRegion,
  deleteRegion,
  // --- Traditions Controllers ---
  getAllTraditions,
  getTraditionsByCategory,
  createTradition,
  updateTradition,
  deleteTradition,
  // --- Combined Asset ---
  getCategoryAssets
} from '../controllers/adminController.js';

// আপনার বিদ্যমান মিডলওয়্যার ইম্পোর্ট
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import upload from '../config/multer.js';

const router = express.Router();

// --- ১. পাবলিক / ফেচ রাউটস (Auth এর বাইরে) ---
router.get('/categories', getAllCategories);
router.get('/tags/by-category/:categoryId', getTagsByCategory);
router.get('/regions/by-category/:categoryId', getRegionsByCategory);
router.get('/traditions/by-category/:categoryId', getTraditionsByCategory);
router.get('/category-assets/:categoryId', getCategoryAssets);

// --- ২. অ্যাডমিন অথোরাইজেশন মিডলওয়্যার ---
// নিচের সব রাউটের জন্য এই মিডলওয়্যারগুলো অটোমেটিক অ্যাপ্লাই হবে
router.use(authMiddleware);
router.use(authorizeRoles('admin'));

// --- ৩. স্ট্যাটস ও ট্রানজেকশন ---
router.get('/stats', getAdminStats);
router.get('/transactions', getAllTransactions);
router.get('/export-transactions', exportTransactionsExcel);
router.get('/export-transactions-range', exportTransactionsByRange);

// --- ৪. লিস্টিং ম্যানেজমেন্ট (পিনিং সিস্টেমসহ) ---
router.get('/listings', manageListings);
router.get('/promoted-listings', getPromotedListings);
router.put('/update-status/:id', updateListingStatus);

// অ্যাডমিন পিন ও আনপিন রাউট (এখানে আলাদাভাবে মিডলওয়্যার দেয়ার দরকার নেই কারণ উপরে 'router.use' করা হয়েছে)
router.patch('/listings/:id/pin', pinListing);
router.patch('/listings/:id/unpin', unpinListing);

// --- ৫. ইউজার ম্যানেজমেন্ট ---
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.get('/export-users', exportUsersExcel);
router.get('/creator-requests', getCreatorRequests);
router.put('/approve-creator/:userId', approveCreator);
router.put('/reject-creator/:userId', rejectCreator);
router.put('/toggle-status/:userId', toggleUserStatus);
router.put('/update-ppc-balance/:id', updatePpcBalanceManual);

// --- ৬. ক্যাটাগরি CRUD ---
router.post('/categories', createCategory);
router.put('/categories/reorder', updateCategoryOrder);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// --- ৭. ট্যাগ CRUD ---
router.post('/tags', createTag);
router.put('/tags/:id', updateTag);
router.delete('/tags/:id', deleteTag);

// --- ৮. রিজিয়ন CRUD ---
router.get('/regions', getAllRegions);
router.post('/regions', createRegion);
router.put('/regions/:id', updateRegion);
router.delete('/regions/:id', deleteRegion);

// --- ৯. ট্র্যাডিশন CRUD ---
router.get('/traditions', getAllTraditions);
router.post('/traditions', createTradition);
router.put('/traditions/:id', updateTradition);
router.delete('/traditions/:id', deleteTradition);

export default router;