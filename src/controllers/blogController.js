import Blog from '../models/Blog.js';
import Comment from '../models/Comment.js';

// --- ADMIN ONLY: Create Blog ---
export const createBlog = async (req, res) => {
  try {
    const { category, title, authorName, authorRole, authorImage, tags, description, content } =
      req.body;

    if (!req.file) return res.status(400).json({ message: 'Main banner image is required' });

    // parse strings to arrays if they come as strings from multipart/form-data
    const parsedTags = typeof tags === 'string' ? tags.split(',').map((t) => t.trim()) : tags;
    const parsedContent = typeof content === 'string' ? JSON.parse(content) : content;

    const newBlog = await Blog.create({
      category,
      title,
      author: {
        name: authorName,
        role: authorRole,
        image: authorImage, // Author photo could be a static URL or another upload
      },
      image: req.file.path, // Cloudinary URL from Multer
      tags: parsedTags,
      description,
      content: parsedContent,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, blog: newBlog });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- GET ALL BLOGS (with Pagination) ---
export const getBlogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const blogs = await Blog.find().sort({ createdAt: -1 }).skip(skip).limit(limit);

    const total = await Blog.countDocuments();

    res.status(200).json({
      success: true,
      blogs,
      pagination: { total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- GET SINGLE BLOG BY ID ---
export const getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: 'Blog not found' });
    res.status(200).json({ success: true, blog });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- ADMIN ONLY: Update/Delete Blog ---
export const updateBlog = async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.file) updateData.image = req.file.path;

    const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.status(200).json({ success: true, blog: updatedBlog });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteBlog = async (req, res) => {
  try {
    await Blog.findByIdAndDelete(req.params.id);
    // ব্লগ ডিলিট হলে ওর আন্ডারে সব কমেন্ট ডিলিট করে দেওয়া ভালো
    await Comment.deleteMany({ blogId: req.params.id });
    res.status(200).json({ message: 'Blog and associated comments deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
