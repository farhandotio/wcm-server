import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
  },
  { timestamps: true }
);

tagSchema.index({ title: 1, category: 1 }, { unique: true });

export default mongoose.model('Tag', tagSchema);
