import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

export const TRANSLATION_NOTIFICATION_EVENTS = Object.freeze([
  'available',
  'failed',
  'updated',
  'requires_attention',
  'review_requested',
  'review_assigned',
  'bulk_operation_completed',
  'review_outcome',
]);
export const TRANSLATION_NOTIFICATION_RETENTION_DAYS = 90;

const translationNotificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: {
      type: String,
      enum: TRANSLATION_NOTIFICATION_EVENTS,
      required: true,
      index: true,
    },
    businessObjectType: {
      type: String,
      enum: Object.keys(BUSINESS_OBJECT_REGISTRY),
      required: true,
    },
    businessObjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    languageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
    },
    translationRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationRecord',
      default: null,
    },
    dedupeKey: { type: String, required: true, unique: true, immutable: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    outboxStatus: {
      type: String,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending',
      index: true,
    },
    outboxAttempts: { type: Number, default: 0, min: 0 },
    outboxProcessedAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      required: true,
      default: () =>
        new Date(Date.now() + TRANSLATION_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

translationNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
translationNotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export default mongoose.models.TranslationNotification ||
  mongoose.model('TranslationNotification', translationNotificationSchema);
