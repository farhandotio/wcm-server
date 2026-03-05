import express from 'express';
import { getCreatorDashboardStats, getMyTransactions, getPromotionAnalytics } from '../controllers/creatorController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

const router = express.Router();

router.use(authMiddleware);
router.use(authorizeRoles('creator'));

router.get('/stats', getCreatorDashboardStats);

router.get('/payments', getMyTransactions);

router.get('/promotion-insights/:id', getPromotionAnalytics);

export default router;
