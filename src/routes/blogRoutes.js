import express from 'express';
const router = express.Router();
import upload from '../config/multer.js'; // আপনার দেওয়া multer config
import { protect, admin } from '../middleware/authMiddleware.js'; // আপনার মিডলওয়্যার
import {
  createBlog,
  getBlogs,
  getBlogById,
  updateBlog,
  deleteBlog,
} from '../controllers/blogController.js';
import {
  createComment,
  getCommentsByBlog,
  deleteComment,
} from '../controllers/commentController.js';

// --- BLOG ROUTES ---
router.get('/', getBlogs);
router.get('/:id', getBlogById);
router.post('/', protect, admin, upload.single('image'), createBlog);
router.put('/:id', protect, admin, upload.single('image'), updateBlog);
router.delete('/:id', protect, admin, deleteBlog);

// --- COMMENT ROUTES ---
router.get('/:blogId/comments', getCommentsByBlog);
router.post('/comments', protect, createComment); // User and Admin both can use this
router.delete('/comments/:id', protect, deleteComment); // Security logic handled in controller

export default router;
