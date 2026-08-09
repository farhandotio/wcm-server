import mongoose from 'mongoose';
import slugify from 'slugify';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import {
  isSupportedLanguageCode,
  normalizeLanguageCode,
} from '../config/supportedLanguages.js';
import { calculateTranslationPurgeAt } from '../config/translationRetention.js';

const normalizeSlug = (value) =>
  slugify(typeof value === 'string' ? value : '', { lower: true, strict: true, trim: true });

const localizedUrlRedirectSchema = new mongoose.Schema(
  {
    businessObjectType: {
      type: String,
      enum: Object.keys(BUSINESS_OBJECT_REGISTRY),
      required: true,
      immutable: true,
      index: true,
    },
    businessObjectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
      index: true,
    },
    languageCode: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: isSupportedLanguageCode,
        message: '{VALUE} is not a supported language code',
      },
    },
    oldSlug: { type: String, required: true, immutable: true, trim: true },
    normalizedOldSlug: { type: String, required: true, immutable: true },
    targetSlug: { type: String, required: true, trim: true },
    normalizedTargetSlug: { type: String, required: true },
    statusCode: { type: Number, enum: [301, 308], default: 301, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    businessObjectDeletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
  },
  { timestamps: true }
);

localizedUrlRedirectSchema.index(
  { languageCode: 1, businessObjectType: 1, normalizedOldSlug: 1 },
  { unique: true, name: 'unique_localized_redirect_source' }
);
localizedUrlRedirectSchema.index({
  languageCode: 1,
  businessObjectType: 1,
  normalizedTargetSlug: 1,
});
localizedUrlRedirectSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

localizedUrlRedirectSchema.pre('validate', function normalizeRedirect() {
  this.languageCode = normalizeLanguageCode(this.languageCode);
  this.normalizedOldSlug = normalizeSlug(this.oldSlug);
  this.normalizedTargetSlug = normalizeSlug(this.targetSlug);
  this.oldSlug = this.normalizedOldSlug;
  this.targetSlug = this.normalizedTargetSlug;

  if (!this.normalizedOldSlug) {
    this.invalidate('oldSlug', 'Old slug must contain at least one letter or number');
  }
  if (!this.normalizedTargetSlug) {
    this.invalidate('targetSlug', 'Target slug must contain at least one letter or number');
  }
  if (this.normalizedOldSlug === this.normalizedTargetSlug) {
    this.invalidate('targetSlug', 'Redirect source and target slugs must differ');
  }

  this.purgeAt = calculateTranslationPurgeAt(this.businessObjectDeletedAt);
});

export default mongoose.models.LocalizedUrlRedirect ||
  mongoose.model('LocalizedUrlRedirect', localizedUrlRedirectSchema);
