import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

export const TRANSLATION_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

const translationProposalSchema = new mongoose.Schema(
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
    businessObjectId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, index: true },
    languageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
      immutable: true,
    },
    sourceVersion: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
    expectedTranslationVersion: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    sourceContent: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    proposedContent: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    proposedSlug: { type: String, trim: true, default: null, immutable: true },
    proposedSeo: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
    jobId: { type: String, trim: true, default: null, immutable: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    requestedByRole: { type: String, enum: ['admin', 'creator'], required: true, immutable: true },
    status: {
      type: String,
      enum: ['active', 'accepted', 'discarded', 'cancelled'],
      default: 'active',
      required: true,
      index: true,
    },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + TRANSLATION_PROPOSAL_TTL_MS),
    },
  },
  { timestamps: true, minimize: false }
);

translationProposalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
translationProposalSchema.index(
  { translationRecordId: 1, languageCode: 1, requestedBy: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'one_active_creator_proposal',
  }
);

export default mongoose.models.TranslationProposal ||
  mongoose.model('TranslationProposal', translationProposalSchema);
