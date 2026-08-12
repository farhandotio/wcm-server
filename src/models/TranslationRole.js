import mongoose from 'mongoose';

export const TRANSLATION_PERMISSIONS = Object.freeze([
  'translation.centre.read',
  'translation.review.assign',
  'translation.review.decide',
  'translation.review.edit',
  'translation.review.regenerate',
  'translation.policy.manage',
  'translation.roles.manage',
  'translation.configuration.manage',
  'translation.terminology.manage',
  'translation.memory.manage',
  'translation.operations.read',
  'translation.alerts.manage',
]);

export const TRANSLATION_ROLE_PRESETS = Object.freeze({
  translation_manager: [...TRANSLATION_PERMISSIONS],
  translation_reviewer: [
    'translation.centre.read',
    'translation.review.assign',
    'translation.review.decide',
    'translation.review.edit',
    'translation.review.regenerate',
  ],
});

const translationRoleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, lowercase: true, unique: true },
  permissions: { type: [{ type: String, enum: TRANSLATION_PERMISSIONS }], default: [] },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

translationRoleSchema.index({ members: 1, isActive: 1 });

export default mongoose.models.TranslationRole || mongoose.model('TranslationRole', translationRoleSchema);
