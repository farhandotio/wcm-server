import mongoose from 'mongoose';
import slugify from 'slugify';
import {
  BUSINESS_OBJECT_REGISTRY,
  validateTranslatableContent,
} from '../config/businessObjectRegistry.js';
import {
  isSupportedLanguageCode,
  normalizeLanguageCode,
} from '../config/supportedLanguages.js';
import { calculateTranslationPurgeAt } from '../config/translationRetention.js';

export const TRANSLATION_STATUSES = Object.freeze([
  'ai_generated',
  'creator_reviewed',
  'admin_reviewed',
  'outdated',
  'failed',
  'rejected',
  'returned_for_modification',
]);

export const PUBLICATION_STATUSES = Object.freeze([
  'published',
  'draft',
  'unpublished',
  'archived',
]);

export const REVIEW_LEVELS = Object.freeze([
  'ai_generated',
  'creator_reviewed',
  'admin_reviewed',
  'verified',
]);

const seoSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },
    keywords: [{ type: String, trim: true }],
    imageAlt: { type: String, trim: true, default: null },
    openGraphTitle: { type: String, trim: true, default: null },
    openGraphDescription: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const metadataSchema = new mongoose.Schema(
  {
    provider: { type: String, trim: true, default: null },
    model: { type: String, trim: true, default: null },
    confidence: { type: Number, min: 0, max: 1, default: null },
    sourceVersion: { type: Number, min: 1, default: 1 },
    sourceHash: { type: String, trim: true, default: null },
    lastReviewedAt: { type: Date, default: null },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewerRole: { type: String, enum: ['admin', 'creator', null], default: null },
    promptVersion: { type: String, trim: true, default: null },
    memoryHit: { type: Boolean, default: false },
    origin: {
      type: String,
      enum: ['ai', 'creator', 'administrator', 'migration'],
      required: true,
    },
    originalOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const translationRecordSchema = new mongoose.Schema(
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
    content: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
    slug: { type: String, trim: true, default: null },
    normalizedSlug: { type: String, default: null, select: false },
    seo: { type: seoSchema, default: () => ({}) },
    translationStatus: {
      type: String,
      enum: TRANSLATION_STATUSES,
      default: 'ai_generated',
      required: true,
      index: true,
    },
    publicationStatus: {
      type: String,
      enum: PUBLICATION_STATUSES,
      default: 'draft',
      required: true,
      index: true,
    },
    reviewLevel: {
      type: String,
      enum: REVIEW_LEVELS,
      default: 'ai_generated',
      required: true,
      index: true,
    },
    versionNumber: { type: Number, min: 1, default: 1, required: true },
    metadata: {
      type: metadataSchema,
      required: true,
    },
    businessObjectDeletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false, optimisticConcurrency: true }
);

translationRecordSchema.index(
  { businessObjectType: 1, businessObjectId: 1, languageCode: 1 },
  { unique: true, name: 'one_translation_per_object_language' }
);

translationRecordSchema.index(
  { languageCode: 1, businessObjectType: 1, normalizedSlug: 1 },
  {
    unique: true,
    partialFilterExpression: { normalizedSlug: { $type: 'string' } },
    name: 'unique_localized_slug',
  }
);

translationRecordSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
translationRecordSchema.index({ languageCode: 1, publicationStatus: 1, updatedAt: -1 });

translationRecordSchema.pre('validate', function normalizeAndValidate() {
  this.languageCode = normalizeLanguageCode(this.languageCode);

  if (this.languageCode === 'en') {
    this.invalidate('languageCode', 'English source records are read-only');
  }

  const definition = BUSINESS_OBJECT_REGISTRY[this.businessObjectType];
  const contentValidation = validateTranslatableContent(this.businessObjectType, this.content);

  if (!contentValidation.valid) {
    this.invalidate(
      'content',
      contentValidation.invalidFields.length
        ? `Non-translatable fields: ${contentValidation.invalidFields.join(', ')}`
        : contentValidation.invalidValues?.length
          ? `Invalid translated values: ${contentValidation.invalidValues.join(', ')}`
        : contentValidation.reason
    );
  }

  if (this.slug) {
    if (!definition?.supportsLocalizedSlug) {
      this.invalidate('slug', `${this.businessObjectType} does not support localized slugs`);
      return;
    }

    const normalizedSlug = slugify(this.slug, { lower: true, strict: true, trim: true });

    if (!normalizedSlug) {
      this.invalidate('slug', 'Slug must contain at least one letter or number');
      return;
    }

    this.slug = normalizedSlug;
    this.normalizedSlug = normalizedSlug;
  } else {
    this.normalizedSlug = null;
  }

  this.purgeAt = calculateTranslationPurgeAt(this.businessObjectDeletedAt);
});

const rejectEnglishQueryMutation = async function rejectEnglishQueryMutation() {
  const record = await this.model.findOne(this.getQuery()).select('languageCode').lean();
  if (record?.languageCode === 'en') {
    throw Object.assign(new Error('English source records are read-only'), { code: 'SOURCE_LANGUAGE_READ_ONLY' });
  }
};

translationRecordSchema.pre(['findOneAndUpdate', 'updateOne', 'deleteOne', 'findOneAndDelete'], rejectEnglishQueryMutation);

export default mongoose.models.TranslationRecord ||
  mongoose.model('TranslationRecord', translationRecordSchema);
