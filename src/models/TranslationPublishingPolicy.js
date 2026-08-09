import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

export const PUBLICATION_MODES = Object.freeze([
  'automatic',
  'master_approval_gated',
  'manual_review',
]);

const translationPublishingPolicySchema = new mongoose.Schema(
  {
    businessObjectType: {
      type: String,
      enum: Object.keys(BUSINESS_OBJECT_REGISTRY),
      required: true,
      immutable: true,
    },
    languageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
      immutable: true,
    },
    version: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
    publicationMode: { type: String, enum: PUBLICATION_MODES, required: true },
    requiredMasterStatus: { type: String, trim: true, default: null },
    creatorImprovementMode: {
      type: String,
      enum: ['immediate_publish', 'manual_review'],
      default: 'manual_review',
      required: true,
    },
    verifiedAdminOnly: { type: Boolean, default: true, immutable: true },
    isActive: { type: Boolean, default: false, index: true },
    activatedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

translationPublishingPolicySchema.index(
  { businessObjectType: 1, languageCode: 1, version: 1 },
  { unique: true, name: 'unique_publishing_policy_version' }
);
translationPublishingPolicySchema.index(
  { businessObjectType: 1, languageCode: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'one_active_publishing_policy',
  }
);

export default mongoose.models.TranslationPublishingPolicy ||
  mongoose.model('TranslationPublishingPolicy', translationPublishingPolicySchema);
