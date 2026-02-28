import mongoose from 'mongoose';

const listingSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    externalUrls: [
      {
        type: String,
        trim: true,
      },
    ],
    websiteLink: {
      type: String,
      trim: true,
    },
    region: {
      type: String,
      required: true,
    },
    country: {
      type: String,
      required: true,
    },
    tradition: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    culturalTags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tag',
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    image: {
      type: String,
      required: true,
    },
    favorites: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    
    // Promotion fields
    promotion: {
      level: {
        type: Number,
        default: 0,
      },
      type: {
        type: String,
        enum: ['none', 'boost', 'ppc'],
        default: 'none',
      },
      expiresAt: {
        type: Date,
      },
      ppcBalance: {
        type: Number,
        default: 0,
      },
      costPerClick: {
        type: Number,
        default: 0,
      },
    },
    isPromoted: {
      type: Boolean,
      default: false,
    },

    views: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

listingSchema.index({ title: 'text', country: 'text', tradition: 'text', description: 'text' });

const Listing = mongoose.model('Listing', listingSchema);
export default Listing;
