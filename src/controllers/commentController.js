import mongoose from 'mongoose';
import Comment from '../models/Comment.js';
import Blog from '../models/Blog.js';

export const createComment = async (req, res) => {
  try {
    const { blogId, text, parentCommentId } = req.body;

    const newComment = await Comment.create({
      blogId,
      user: req.user._id,
      text,
      parentComment: parentCommentId || null,
      isAdminReply: req.user.role === 'admin', // role logic check
    });

    res.status(201).json({ success: true, comment: newComment });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// export const getCommentsByBlog = async (req, res) => {
//   try {
//     // শুধুমাত্র মেইন কমেন্টগুলো আনবে, রিপ্লাইগুলো পপুলেট হবে
//     const comments = await Comment.find({ blogId: req.params.blogId, parentComment: null })
//       .populate('user', 'firstName lastName image')
//       .populate({
//         path: 'replies',
//         populate: { path: 'user', select: 'firstName lastName image' },
//       })
//       .sort({ createdAt: -1 });

//     res.status(200).json({ success: true, comments });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// backend/controllers/commentController.js

export const getCommentsByBlog = async (req, res) => {
  try {
    const { id } = req.params; // এখানে id-ই আসবে কারণ ফ্রন্টএন্ডে /api/blogs/${id}/comments আছে

    const blogQuery = mongoose.Types.ObjectId.isValid(id) 
      ? { _id: id } 
      : { slug: id };

    const blog = await Blog.findOne(blogQuery).select('_id');

    if (!blog) {
      // এটি ৫০০ নয়, ৪-০-৪ হতে হবে
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }

    const comments = await Comment.find({ blogId: blog._id, parentComment: null })
      .populate('user', 'firstName lastName image')
      .populate({
        path: 'replies',
        populate: { path: 'user', select: 'firstName lastName image' },
      })
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, comments });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    if (req.user.role === 'admin' || comment.user.toString() === req.user._id.toString()) {
      // কমেন্ট এবং তার আন্ডারে থাকা সব রিপ্লাই একসাথে ডিলিট হবে
      await Comment.deleteMany({
        $or: [{ _id: req.params.id }, { parentComment: req.params.id }],
      });

      return res.status(200).json({ message: 'Comment deleted successfully' });
    }

    res.status(403).json({ message: 'Unauthorized' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
