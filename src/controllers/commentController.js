import Comment from '../models/Comment.js';

// --- CREATE COMMENT / REPLY ---
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

// --- GET COMMENTS FOR A BLOG ---
export const getCommentsByBlog = async (req, res) => {
  try {
    // শুধুমাত্র মেইন কমেন্টগুলো আনবে, রিপ্লাইগুলো পপুলেট হবে
    const comments = await Comment.find({ blogId: req.params.blogId, parentComment: null })
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

// --- DELETE COMMENT (Admin Only or Owner) ---
export const deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    // Only Admin or the User who commented can delete
    if (req.user.role === 'admin' || comment.user.toString() === req.user._id.toString()) {
      await Comment.deleteMany({ $or: [{ _id: req.params.id }, { parentComment: req.params.id }] });
      return res.status(200).json({ message: 'Comment deleted successfully' });
    }

    res.status(403).json({ message: 'Unauthorized' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
