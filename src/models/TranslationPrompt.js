import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';

const translationPromptSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, lowercase: true, trim: true },
    version: { type: Number, required: true, min: 1, validate: Number.isInteger },
    businessObjectType: {
      type: String,
      enum: [...Object.keys(BUSINESS_OBJECT_REGISTRY), null],
      default: null,
    },
    systemTemplate: { type: String, required: true, trim: true },
    userTemplate: { type: String, required: true, trim: true },
    requiredVariables: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: false, index: true },
    activatedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

translationPromptSchema.index(
  { key: 1, version: 1 },
  { unique: true, name: 'unique_prompt_version' }
);
translationPromptSchema.index(
  { key: 1, businessObjectType: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'one_active_prompt_per_scope',
  }
);

export default mongoose.models.TranslationPrompt ||
  mongoose.model('TranslationPrompt', translationPromptSchema);
