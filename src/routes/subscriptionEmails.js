// routes/subscriptionEmails.js
import express from 'express';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import { allEmail, create, deleteEmail, deleteAllEmails } from '../controllers/subscriptionEmailsController.js';
const router = express.Router();

router.post('/', create);
router.get('/', authMiddleware, authorizeRoles('admin'), allEmail);
router.delete('/:id', authMiddleware, authorizeRoles('admin'), deleteEmail); // Delete single
router.delete('/', authMiddleware, authorizeRoles('admin'), deleteAllEmails); // Delete all

export default router;