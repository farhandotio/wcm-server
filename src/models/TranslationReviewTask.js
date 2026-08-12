import mongoose from 'mongoose';
import { calculateTranslationPurgeAt } from '../config/translationRetention.js';

export const TRANSLATION_REVIEW_TASK_STATUSES = Object.freeze([
  'pending', 'assigned', 'in_review', 'approved', 'rejected',
  'returned_for_modification', 'cancelled',
]);

const historySchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  comment: { type: String, trim: true, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { _id: false });

const translationReviewTaskSchema = new mongoose.Schema({
  translationRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'TranslationRecord', required: true, index: true },
  businessObjectType: { type: String, required: true, immutable: true, index: true },
  businessObjectId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true, index: true },
  languageCode: { type: String, required: true, lowercase: true, trim: true, immutable: true, index: true },
  policySnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  status: { type: String, enum: TRANSLATION_REVIEW_TASK_STATUSES, default: 'pending', index: true },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  history: { type: [historySchema], default: [] },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedAt: { type: Date, default: null },
  businessObjectDeletedAt: { type: Date, default: null },
  purgeAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

translationReviewTaskSchema.index({ translationRecordId: 1, status: 1 });
translationReviewTaskSchema.index({ status: 1, assignee: 1, updatedAt: -1 });
translationReviewTaskSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
translationReviewTaskSchema.pre('validate', function applyRetention() {
  this.purgeAt = calculateTranslationPurgeAt(this.businessObjectDeletedAt);
});

export default mongoose.models.TranslationReviewTask || mongoose.model('TranslationReviewTask', translationReviewTaskSchema);
