import mongoose from 'mongoose';

const blogSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    category: { type: String, required: true, index: true },
    title: { type: String, required: true },
    author: {
      name: { type: String, required: true },
      role: { type: String, required: true },
      image: { type: String, required: true }, // Author's profile image
    },
    image: { type: String, required: true }, // Main Banner Image
    tags: [{ type: String }],
    description: { type: String, required: true },

    // Content array: dynamic handling of paragraph, heading, quote, image_grid
    content: [
      {
        type: {
          type: String,
          enum: ['paragraph', 'heading', 'image_grid', 'quote'],
          required: true,
        },
        text: { type: String }, // Used for paragraph, heading, quote
        images: [{ type: String }], // Used only when type is 'image_grid'
      },
    ],

    // Admin reference who created this blog
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

blogSchema.index({ title: 'text', category: 'text' });

export default mongoose.model('Blog', blogSchema);
