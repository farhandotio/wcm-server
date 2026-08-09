import mongoose from 'mongoose';
import { BUSINESS_OBJECT_REGISTRY } from '../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

const usageSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, trim: true, index: true },
    businessObjectType: { type: String, enum: Object.keys(BUSINESS_OBJECT_REGISTRY), required: true, index: true },
    businessObjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    languageCode: { type: String, required: true, lowercase: true, trim: true, validate: isSupportedLanguageCode, index: true },
    provider: { type: String, required: true, trim: true },
    model: { type: String, default: null, trim: true },
    outcome: { type: String, enum: ['success', 'failure'], required: true, index: true },
    latencyMs: { type: Number, min: 0, default: null },
    inputTokens: { type: Number, min: 0, default: null },
    outputTokens: { type: Number, min: 0, default: null },
    totalTokens: { type: Number, min: 0, default: null },
    memoryHit: { type: Boolean, default: false, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

usageSchema.index({ businessObjectId: 1, languageCode: 1, createdAt: -1 });

export default mongoose.models.TranslationUsageEvent ||
  mongoose.model('TranslationUsageEvent', usageSchema);
