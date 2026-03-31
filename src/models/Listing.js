import mongoose from 'mongoose';

const roundToTwo = (v) => Math.round(v * 100) / 100;

const REASON_CODES = [
  'ILLEGAL_CONTENT',
  'HATE_OR_EXTREMISM',
  'CULTURAL_MISREPRESENTATION',
  'COPYRIGHT_ISSUE',
  'COUNTERFEIT_OR_FRAUD',
  'QUALITY_ISSUE',
  'MISLEADING_LINK',
  'SPAM',
  'ADMIN_DECISION',
  'NOT_RELEVANT_TO_OUR_BUSINESS_MODEL',
];

const listingSchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    externalUrls: [{ type: String, trim: true }],
    websiteLink: { type: String, trim: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    tradition: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    culturalTags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'blocked'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      enum: {
        values: [...REASON_CODES, ''], 
        message: '{VALUE} is not a valid reason code',
      },
      default: '',
    },
    additionalReason: { type: String, trim: true, default: '' },
    image: { type: String, required: true },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    promotion: {
      level: { type: Number, default: 0 },
      boost: {
        isActive: { type: Boolean, default: false },
        isPaused: { type: Boolean, default: false },
        amountPaid: { type: Number, default: 0, set: roundToTwo },
        durationDays: { type: Number, default: 0 },
        expiresAt: { type: Date },
      },
      ppc: {
        isActive: { type: Boolean, default: false },
        ppcBalance: { type: Number, default: 0, set: roundToTwo },
        costPerClick: { type: Number, default: 0.1, set: roundToTwo },
        isPaused: { type: Boolean, default: false },
        totalClicks: { type: Number, default: 0 },
        executedClicks: { type: Number, default: 0 },
        amountPaid: { type: Number, default: 0, set: roundToTwo },
      },
      isPromoted: { type: Boolean, default: false },
    },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Indexes
listingSchema.index({ status: 1, rejectionReason: 1 });
listingSchema.index({
  title: 'text',
  description: 'text',
  country: 'text',
  region: 'text',
  tradition: 'text',
});
listingSchema.index({ isPromoted: 1 });
listingSchema.index({ status: 1 });

const Listing = mongoose.model('Listing', listingSchema);
export default Listing;
