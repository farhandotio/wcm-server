import express from 'express';
import {
  getAllUsers,
  getCreatorRequests,
  approveCreator,
  rejectCreator,
  toggleUserStatus,
  manageListings,
  updateListingStatus,
  pinListing,
  unpinListing,
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
  getAllRegions,
  getRegionsByCategory,
  createRegion,
  updateRegion,
  deleteRegion,
  getAllTraditions,
  getTraditionsByCategory,
  createTradition,
  updateTradition,
  deleteTradition,
  // ===== HOW IT WORKS =====
  getPageContent,
  updatePageContent,
  addStep,
  updateSingleStep,
  deleteStep,
  getCategoryAssets,
  getBackupList,
  handleManualBackup,
  handleManualRestore,
  deleteBackupFile,
} from '../controllers/adminController.js';

import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import upload from '../config/multer.js';

const router = express.Router();

// ===== PUBLIC ROUTES =====
router.get('/categories', getAllCategories);
router.get('/tags/by-category/:categoryId', getTagsByCategory);
router.get('/regions/by-category/:categoryId', getRegionsByCategory);
router.get('/traditions/by-category/:categoryId', getTraditionsByCategory);
router.get('/category-assets/:categoryId', getCategoryAssets);

// How It Works - Public
router.get('/how-it-works', getPageContent);

// ===== ADMIN PROTECTED ROUTES =====
router.use(authMiddleware);
router.use(authorizeRoles('admin'));

// How It Works - Admin
router.put('/how-it-works', updatePageContent);
router.post('/how-it-works/steps', addStep);
router.put('/how-it-works/steps/:stepId', updateSingleStep);
router.delete('/how-it-works/steps/:stepId', deleteStep);

// Stats & Transactions
router.get('/stats', getAdminStats);
router.get('/transactions', getAllTransactions);
router.get('/export-transactions', exportTransactionsExcel);
router.get('/export-transactions-range', exportTransactionsByRange);

// Listings
router.get('/listings', manageListings);
router.get('/promoted-listings', getPromotedListings);
router.put('/update-status/:id', updateListingStatus);
router.patch('/listings/:id/pin', pinListing);
router.patch('/listings/:id/unpin', unpinListing);

// Users
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.get('/export-users', exportUsersExcel);
router.get('/creator-requests', getCreatorRequests);
router.put('/approve-creator/:userId', approveCreator);
router.put('/reject-creator/:userId', rejectCreator);
router.put('/toggle-status/:userId', toggleUserStatus);
router.put('/update-ppc-balance/:id', updatePpcBalanceManual);

// Categories
router.post('/categories', createCategory);
router.put('/categories/reorder', updateCategoryOrder);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Tags
router.post('/tags', createTag);
router.put('/tags/:id', updateTag);
router.delete('/tags/:id', deleteTag);

// Regions
router.get('/regions', getAllRegions);
router.post('/regions', createRegion);
router.put('/regions/:id', updateRegion);
router.delete('/regions/:id', deleteRegion);

// Traditions
router.get('/traditions', getAllTraditions);
router.post('/traditions', createTradition);
router.put('/traditions/:id', updateTradition);
router.delete('/traditions/:id', deleteTradition);

// DB backups
// Database Management APIs
router.get('/database/backups', getBackupList);
router.post('/database/backup', handleManualBackup);
router.post('/database/restore', handleManualRestore);
router.delete('/database/backups/:fileName', deleteBackupFile);

export default router;