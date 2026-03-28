import mongoose from 'mongoose';

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


const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['user', 'creator', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'blocked'],
      default: 'active',
    },
    creatorRequest: {
      isApplied: { type: Boolean, default: false },
      appliedAt: { type: Date },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'needs_review'],
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
      adminComment: { type: String, default: '' },
    },
    profile: {
      displayName: { type: String },
      businessName: { type: String },
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
      bio: { type: String },
      profileImage: { type: String },
      coverImage: { type: String },

      // --- VAT & Compliance Fields ---
      country: { type: String },
      countryCode: { type: String, uppercase: true, trim: true },
      city: { type: String },

      customerType: {
        type: String,
        enum: ['individual', 'business'],
        default: 'individual',
      },
      vatNumber: {
        type: String,
        trim: true,
        default: '',
      }, // Optional as requested
      isVatValid: {
        type: Boolean,
        default: false,
      }, // VIES validation result
      vatLastChecked: {
        type: Date,
      },
      // -------------------------------

      language: { type: String },
      websiteLink: { type: String },
      socialLink: { type: String },
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    dashboardStats: {
      lastUpdated: { type: Date },
      data: { type: Object },
    },
  },
  { timestamps: true }
);

userSchema.index({ status: 1, rejectionReason: 1 });

const User = mongoose.model('User', userSchema);
export default User;
