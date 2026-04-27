import express from 'express';
import { getSliders, addSlider, deleteSlider, updateSlider } from '../controllers/sliderController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

const router = express.Router();

// 1. সবাই স্লাইডার দেখতে পারবে (No Middleware)
router.get('/', getSliders);

// 2. শুধু লগইন করা 'admin' নতুন স্লাইডার অ্যাড করতে পারবে
router.post('/add', authMiddleware, authorizeRoles('admin'), addSlider);

// 3. শুধু লগইন করা 'admin' স্লাইডার ডিলিট করতে পারবে
router.delete('/:id', authMiddleware, authorizeRoles('admin'), deleteSlider);
// 4. শুধু লগইন করা 'admin' স্লাইডার আপডেট করতে পারবে
router.put('/:id', authMiddleware, authorizeRoles('admin'), updateSlider);

export default router;