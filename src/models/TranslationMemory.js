import mongoose from 'mongoose';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

const translationMemorySchema = new mongoose.Schema(
  {
    sourceLanguageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
    },
    targetLanguageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
    },
    fieldName: { type: String, required: true, trim: true },
    normalizedSource: { type: String, required: true, select: false },
    sourceHash: { type: String, required: true, trim: true },
    targetValue: { type: mongoose.Schema.Types.Mixed, required: true },
    approvalLevel: {
      type: String,
      enum: ['admin_reviewed', 'verified'],
      required: true,
      index: true,
    },
    sourceTranslationRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationRecord',
      default: null,
    },
    sourceTranslationVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationVersion',
      default: null,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

translationMemorySchema.index(
  {
    sourceLanguageCode: 1,
    targetLanguageCode: 1,
    fieldName: 1,
    sourceHash: 1,
  },
  { unique: true, name: 'unique_approved_memory_match' }
);

export default mongoose.models.TranslationMemory ||
  mongoose.model('TranslationMemory', translationMemorySchema);
