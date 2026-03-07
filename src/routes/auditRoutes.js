import express from 'express';
const router = express.Router();
import { getAdminAuditLogs, getCreatorAuditLogs } from '../controllers/auditController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimiter.js';

// --- Creator Routes ---
router.get('/creator/logs', authMiddleware, getCreatorAuditLogs);

// --- Admin Routes ---
router.get('/admin/logs', authLimiter, authMiddleware, authorizeRoles('admin'), getAdminAuditLogs);

export default router;
