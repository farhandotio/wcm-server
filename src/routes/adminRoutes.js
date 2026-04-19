import express from 'express';
import {
  getAllUsers,
  getCreatorRequests,
  approveCreator,
  rejectCreator,
  toggleUserStatus,
  manageListings,
  updateListingStatus,
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

import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import upload from '../config/multer.js';

const router = express.Router();

// --- Public / Fetch Routes (এগুলো Auth এর বাইরে রাখা হয়েছে যাতে ক্রিয়েটররা ড্রপডাউনে ডাটা পায়) ---
router.get('/categories', getAllCategories);
router.get('/tags/by-category/:categoryId', getTagsByCategory);
router.get('/regions/by-category/:categoryId', getRegionsByCategory);
router.get('/traditions/by-category/:categoryId', getTraditionsByCategory);
router.get('/category-assets/:categoryId', getCategoryAssets); 

// --- Admin Authorization Middleware ---
router.use(authMiddleware);
router.use(authorizeRoles('admin'));

// --- Stats & Transactions ---
router.get('/stats', getAdminStats);
router.get('/transactions', getAllTransactions);
router.get('/export-transactions', exportTransactionsExcel);
router.get('/export-transactions-range', exportTransactionsByRange);

// --- Listings Management ---
router.get('/listings', manageListings);
router.get('/promoted-listings', getPromotedListings);
router.put('/update-status/:id', updateListingStatus);

// --- User Management ---
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.get('/export-users', exportUsersExcel);
router.get('/creator-requests', getCreatorRequests);
router.put('/approve-creator/:userId', approveCreator);
router.put('/reject-creator/:userId', rejectCreator);
router.put('/toggle-status/:userId', toggleUserStatus);
router.put('/update-ppc-balance/:id', updatePpcBalanceManual);

// --- Categories CRUD ---
router.post('/categories', createCategory);
router.put('/categories/reorder', updateCategoryOrder);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// --- Tags CRUD ---
router.post('/tags', createTag);
router.put('/tags/:id', updateTag);
router.delete('/tags/:id', deleteTag);

// --- Regions CRUD ---
router.get('/regions', getAllRegions);
router.post('/regions', createRegion);
router.put('/regions/:id', updateRegion);
router.delete('/regions/:id', deleteRegion);

// --- Traditions CRUD ---
router.get('/traditions', getAllTraditions);
router.post('/traditions', createTradition);
router.put('/traditions/:id', updateTradition);
router.delete('/traditions/:id', deleteTradition);

export default router;