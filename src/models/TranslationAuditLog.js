import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';
import { calculateTranslationPurgeAt } from '../config/translationRetention.js';

const actorSnapshotSchema = new mongoose.Schema(
  {
    displayName: { type: String, default: null },
    role: { type: String, enum: ['admin', 'creator', 'system', 'ai'], required: true },
  },
  { _id: false }
);

const translationAuditLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      match: /^[a-z]+(?:\.[a-z0-9_-]+)+$/,
      index: true,
    },
    outcome: {
      type: String,
      enum: ['pending', 'success', 'failure'],
      required: true,
      immutable: true,
      index: true,
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
    languageCode: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
      index: true,
    },
    translationRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationRecord',
      default: null,
      immutable: true,
    },
    translationVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationVersion',
      default: null,
      immutable: true,
    },
    actorType: {
      type: String,
      enum: ['admin', 'creator', 'system', 'ai'],
      required: true,
      immutable: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
    },
    actorSnapshot: { type: actorSnapshotSchema, required: true, immutable: true },
    requestId: { type: String, trim: true, default: null, immutable: true },
    jobId: { type: String, trim: true, default: null, immutable: true },
    ipAddress: { type: String, trim: true, default: null, immutable: true },
    userAgent: { type: String, trim: true, default: null, immutable: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
    businessObjectDeletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  }
);

translationAuditLogSchema.index({ businessObjectId: 1, languageCode: 1, createdAt: -1 });
translationAuditLogSchema.index({ translationRecordId: 1, createdAt: -1 });
translationAuditLogSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

translationAuditLogSchema.pre('validate', function validateActorAndRetention() {
  if (['admin', 'creator'].includes(this.actorType) && !this.actor) {
    this.invalidate('actor', `actor is required for ${this.actorType} events`);
  }

  this.purgeAt = calculateTranslationPurgeAt(this.businessObjectDeletedAt);
});

export default mongoose.models.TranslationAuditLog ||
  mongoose.model('TranslationAuditLog', translationAuditLogSchema);
