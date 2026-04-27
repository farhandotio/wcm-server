import Blog from '../models/Blog.js';
import Comment from '../models/Comment.js';
import mongoose from 'mongoose';
import slugify from 'slugify';

// --- ADMIN ONLY: Create Blog ---
export const createBlog = async (req, res) => {
  try {
    const { category, title, tags, description, content } = req.body;

    const slug = slugify(title, { lower: true, strict: true });

    // ১. মেইন ব্যানার চেক (req.files এ 'image' ফিল্ড চেক করা হচ্ছে)
    const mainBanner = req.files.find((file) => file.fieldname === 'image');
    if (!mainBanner) return res.status(400).json({ message: 'Main banner image is required' });

    // ২. ডাটা পার্স করা
    const parsedTags = typeof tags === 'string' ? tags.split(',').map((t) => t.trim()) : tags;
    let parsedContent = typeof content === 'string' ? JSON.parse(content) : content;

    // ৩. ডাইনামিক গ্রিড ইমেজ প্রসেসিং
    // ফ্রন্টেন্ড থেকে gridImages_0, gridImages_1 এভাবে ডাটা আসছে
    if (req.files && Array.isArray(parsedContent)) {
      parsedContent = parsedContent.map((block, index) => {
        if (block.type === 'image_grid') {
          const fieldName = `gridImages_${index}`;
          // এই ব্লকের জন্য যতগুলো ইমেজ আপলোড হয়েছে তাদের Cloudinary URL বের করা
          const gridImages = req.files
            .filter((file) => file.fieldname === fieldName)
            .map((file) => file.path);

          return { ...block, images: gridImages };
        }
        return block;
      });
    }

    // ৪. অ্যাডমিন প্রোফাইল থেকে অথর ইনফো নেয়া
    const admin = req.user;

    const newBlog = await Blog.create({
      slug,
      category,
      title,
      author: {
        name: `${admin.firstName} ${admin.lastName}`,
        role: 'Editorial Team', // বা admin.role
        image: admin.profile?.profileImage || 'https://i.postimg.cc/ncFFN2XS/image-(22).jpg',
      },
      image: mainBanner.path, // Cloudinary Main URL
      tags: parsedTags,
      description,
      content: parsedContent,
      createdBy: admin._id,
    });

    res.status(201).json({ success: true, blog: newBlog });
  } catch (error) {
    console.error('Blog Create Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// --- ADMIN ONLY: Update/Delete Blog ---
// export const updateBlog = async (req, res) => {
//   try {
//     let updateData = { ...req.body };

//     // মেইন ইমেজ আপডেট
//     const mainBanner = req.files?.find((file) => file.fieldname === 'image');
//     if (mainBanner) updateData.image = mainBanner.path;

//     // কন্টেন্ট পার্স এবং গ্রিড ইমেজ আপডেট
//     if (req.body.content) {
//       let parsedContent = JSON.parse(req.body.content);
//       if (req.files) {
//         parsedContent = parsedContent.map((block, index) => {
//           const fieldName = `gridImages_${index}`;
//           const newImages = req.files.filter((f) => f.fieldname === fieldName).map((f) => f.path);
//           if (newImages.length > 0) {
//             return { ...block, images: [...(block.images || []), ...newImages] };
//           }
//           return block;
//         });
//       }
//       updateData.content = parsedContent;
//     }

//     const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, updateData, { new: true });
//     res.status(200).json({ success: true, blog: updatedBlog });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

export const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    let updateData = { ...req.body };

    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { slug: id };

    const blog = await Blog.findOne(query);

    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }

    const mainBanner = req.files?.find((file) => file.fieldname === 'image');
    if (mainBanner) updateData.image = mainBanner.path;

    if (req.body.content) {
      let parsedContent = JSON.parse(req.body.content);
      if (req.files) {
        parsedContent = parsedContent.map((block, index) => {
          const fieldName = `gridImages_${index}`;
          const newImages = req.files.filter((f) => f.fieldname === fieldName).map((f) => f.path);
          if (newImages.length > 0) {
            return { ...block, images: [...(block.images || []), ...newImages] };
          }
          return block;
        });
      }
      updateData.content = parsedContent;
    }

    const updatedBlog = await Blog.findByIdAndUpdate(blog._id, updateData, { new: true });

    res.status(200).json({ success: true, blog: updatedBlog });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- GET ALL BLOGS (with Offset-based Pagination) ---
export const getBlogs = async (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 10;

    const blogs = await Blog.find().sort({ createdAt: -1 }).skip(offset).limit(limit);

    const total = await Blog.countDocuments();

    res.status(200).json({
      success: true,
      blogs,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + blogs.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- GET SINGLE BLOG BY ID ---
// export const getBlogById = async (req, res) => {
//   try {
//     const blog = await Blog.findById(req.params.id);
//     if (!blog) return res.status(404).json({ message: 'Blog not found' });
//     res.status(200).json({ success: true, blog });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

export const getBlogById = async (req, res) => {
  try {
    const { id } = req.params;

    const isObjectId = mongoose.Types.ObjectId.isValid(id);

    let blog;

    if (isObjectId) {
      blog = await Blog.findOne({
        $or: [{ _id: id }, { slug: id }],
      });
    } else {
      blog = await Blog.findOne({ slug: id });
    }

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found',
      });
    }

    res.status(200).json({
      success: true,
      blog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// export const deleteBlog = async (req, res) => {
//   try {
//     await Blog.findByIdAndDelete(req.params.id);
//     // ব্লগ ডিলিট হলে ওর আন্ডারে সব কমেন্ট ডিলিট করে দেওয়া ভালো
//     await Comment.deleteMany({ blogId: req.params.id });
//     res.status(200).json({ message: 'Blog and associated comments deleted' });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

export const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;

    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { slug: id };

    const blog = await Blog.findOne(query);

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    await Blog.findByIdAndDelete(blog._id);

    await Comment.deleteMany({ blogId: blog._id });

    res.status(200).json({ message: 'Blog and associated comments deleted successfully' });
  } catch (error) {
    console.error('Delete Blog Error:', error);
    res.status(500).json({ message: error.message });
  }
};