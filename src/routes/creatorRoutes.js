import express from 'express';
import {
  getCreatorDashboardStats,
  getMyTransactions,
  getPromotionAnalytics,
} from '../controllers/creatorController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import { getAllCategories, getTagsByCategory } from '../controllers/adminController.js';

const router = express.Router();

router.use(authMiddleware);
router.use(authorizeRoles('creator'));

router.get('/categories', getAllCategories);
router.get('/tags/by-category/:categoryId', getTagsByCategory);

router.get('/stats', getCreatorDashboardStats);

router.get('/my-transactions', getMyTransactions);

router.get('/promotion-insights/:id', getPromotionAnalytics);

export default router;
