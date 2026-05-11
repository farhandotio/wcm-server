import express from 'express';
const router = express.Router();
import upload from '../config/multer.js'; // আপনার দেওয়া multer config
import { authMiddleware, authorizeRoles, optionalAuth } from '../middlewares/auth.js';
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
router.get('/', optionalAuth, getBlogs); 
router.get('/:id', getBlogById);
router.post('/', authMiddleware, authorizeRoles('admin'), upload.any(), createBlog);
router.put('/:id', authMiddleware, authorizeRoles('admin'), upload.any(), updateBlog);
router.delete('/:id', authMiddleware, authorizeRoles('admin'), deleteBlog);

// --- COMMENT ROUTES ---
router.get('/:id/comments', getCommentsByBlog);
router.post('/comments', authMiddleware, createComment);
router.delete('/comments/:id', authMiddleware, deleteComment);

export default router;
