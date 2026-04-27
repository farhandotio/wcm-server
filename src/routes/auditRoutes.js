import express from 'express';
const router = express.Router();
import { getAdminAuditLogs, getCreatorAuditLogs } from '../controllers/auditController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

// --- Creator Routes ---
router.get('/creator/logs', authMiddleware, getCreatorAuditLogs);

// --- Admin Routes ---
router.get('/admin/logs', authMiddleware, authorizeRoles('admin'), getAdminAuditLogs);

export default router;
