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
} from '../controllers/adminController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import upload from '../config/multer.js';

const router = express.Router();


router.get('/tags/by-category/:categoryId', getTagsByCategory);
router.get('/categories', getAllCategories);

router.use(authMiddleware);
router.use(authorizeRoles('admin'));

router.get('/stats', getAdminStats);
router.get('/transactions', getAllTransactions);
router.get('/export-transactions', exportTransactionsExcel);
router.get('/listings', manageListings);
router.get('/promoted-listings', getPromotedListings);
router.get('/users', getAllUsers);
router.get('/creator-requests', getCreatorRequests);
router.get('/export-users', exportUsersExcel);

router.post('/categories', createCategory);
router.post('/tags', createTag);

router.put('/categories/reorder', updateCategoryOrder);

router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

router.put('/tags/:id', updateTag);
router.delete('/tags/:id', deleteTag);

router.put('/approve-creator/:userId', approveCreator);
router.put('/reject-creator/:userId', rejectCreator);
router.put('/update-status/:id', updateListingStatus);
router.put('/toggle-status/:userId', toggleUserStatus);
router.put('/update-ppc-balance/:id', updatePpcBalanceManual);

export default router;
