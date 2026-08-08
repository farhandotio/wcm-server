import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

export const TRANSLATION_JOB_STATUSES = Object.freeze([
  'queued',
  'processing',
  'retry_scheduled',
  'completed',
  'failed',
  'dead_letter',
  'cancelled',
  'stale',
]);

const attemptSchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true, min: 1 },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    outcome: { type: String, enum: ['processing', 'success', 'failure', 'timeout'], required: true },
    errorCode: { type: String, trim: true, default: null },
    errorMessage: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const translationJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, immutable: true, trim: true },
    idempotencyKey: { type: String, required: true, unique: true, immutable: true, trim: true },
    operation: {
      type: String,
      enum: ['translate', 'regenerate'],
      default: 'translate',
      required: true,
      immutable: true,
    },
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
    sourceLanguageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
      immutable: true,
    },
    targetLanguageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
      immutable: true,
      index: true,
    },
    sourceVersion: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
    sourceContent: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    status: { type: String, enum: TRANSLATION_JOB_STATUSES, default: 'queued', index: true },
    priority: { type: Number, default: 0, index: true },
    maxAttempts: { type: Number, default: 3, min: 1, max: 10 },
    attemptCount: { type: Number, default: 0, min: 0 },
    attempts: { type: [attemptSchema], default: [] },
    availableAt: { type: Date, default: Date.now, index: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, trim: true, default: null },
    completedAt: { type: Date, default: null },
    failure: {
      code: { type: String, trim: true, default: null },
      message: { type: String, trim: true, default: null },
    },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

translationJobSchema.index({ status: 1, availableAt: 1, priority: -1, createdAt: 1 });

export default mongoose.models.TranslationJob ||
  mongoose.model('TranslationJob', translationJobSchema);
