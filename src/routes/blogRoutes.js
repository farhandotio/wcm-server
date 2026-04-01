import express from 'express';
const router = express.Router();
import upload from '../config/multer.js'; // আপনার দেওয়া multer config
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js'; // আপনার মিডলওয়্যার
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
router.post('/', authMiddleware, authorizeRoles('admin'), upload.any(), createBlog);
router.put('/:id', authMiddleware, authorizeRoles('admin'), upload.any(), updateBlog);
router.delete('/:id', authMiddleware, authorizeRoles('admin'), deleteBlog);

// --- COMMENT ROUTES ---
router.get('/:blogId/comments', getCommentsByBlog);
router.post('/comments', authMiddleware, createComment); // User and Admin both can use this
router.delete('/comments/:id', authMiddleware, authorizeRoles('admin'), deleteComment); // Security logic handled in controller

export default router;
