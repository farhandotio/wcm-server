import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';
import { calculateTranslationPurgeAt } from '../config/translationRetention.js';
import {
  PUBLICATION_STATUSES,
  REVIEW_LEVELS,
  TRANSLATION_STATUSES,
} from './TranslationRecord.js';

const versionSnapshotSchema = new mongoose.Schema(
  {
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    slug: { type: String, default: null },
    seo: { type: mongoose.Schema.Types.Mixed, default: null },
    translationStatus: { type: String, enum: TRANSLATION_STATUSES, default: null },
    publicationStatus: { type: String, enum: PUBLICATION_STATUSES, default: null },
    reviewLevel: { type: String, enum: REVIEW_LEVELS, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, minimize: false }
);

const translationVersionSchema = new mongoose.Schema(
  {
    translationRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationRecord',
      required: true,
      immutable: true,
      index: true,
    },
    businessObjectType: {
      type: String,
      enum: Object.keys(BUSINESS_OBJECT_REGISTRY),
      required: true,
      immutable: true,
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
      validate: isSupportedLanguageCode,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    sourceVersion: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    previousValue: { type: versionSnapshotSchema, default: null, immutable: true },
    newValue: { type: versionSnapshotSchema, required: true, immutable: true },
    modificationSource: {
      type: String,
      enum: ['ai', 'creator', 'administrator', 'system', 'migration'],
      required: true,
      immutable: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
    },
    authorSnapshot: {
      type: new mongoose.Schema(
        {
          displayName: { type: String, default: null },
          role: { type: String, enum: ['admin', 'creator', 'system', 'ai'], required: true },
        },
        { _id: false }
      ),
      required: true,
      immutable: true,
    },
    proposalId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
    rollbackFromVersion: { type: Number, min: 1, default: null, immutable: true },
    businessObjectDeletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  }
);

translationVersionSchema.index(
  { translationRecordId: 1, versionNumber: 1 },
  { unique: true, name: 'unique_translation_version' }
);
translationVersionSchema.index({ businessObjectId: 1, languageCode: 1, createdAt: -1 });
translationVersionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

translationVersionSchema.pre('validate', function validateRetention() {
  this.purgeAt = calculateTranslationPurgeAt(this.businessObjectDeletedAt);
});

export default mongoose.models.TranslationVersion ||
  mongoose.model('TranslationVersion', translationVersionSchema);
