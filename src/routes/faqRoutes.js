import express from 'express';
const router = express.Router();
import { getAllFaqs, createFaq, updateFaq, deleteFaq } from '../controllers/faqController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

// পাবলিকরা দেখতে পারবে
router.get('/', getAllFaqs);

// শুধু অ্যাডমিনরা চেঞ্জ করতে পারবে
router.post('/', authMiddleware, authorizeRoles('admin'), createFaq);
router.put('/:id', authMiddleware, authorizeRoles('admin'), updateFaq); // এডিট রাউট
router.delete('/:id', authMiddleware, authorizeRoles('admin'), deleteFaq);

export default router;