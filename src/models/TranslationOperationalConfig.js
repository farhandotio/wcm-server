import mongoose from 'mongoose';

const configSchema = new mongoose.Schema({
  version: { type: Number, required: true, min: 1, immutable: true },
  isActive: { type: Boolean, default: false, index: true },
  activatedAt: { type: Date, default: null },
  provider: { name: { type: String, required: true, trim: true }, metadata: { type: mongoose.Schema.Types.Mixed, default: {} } },
  queue: { timeoutMs: { type: Number, min: 1000, default: 60000 }, maxAttempts: { type: Number, min: 1, max: 10, default: 3 } },
  alerts: { queuedOrRetryThreshold: { type: Number, min: 1, default: 25 }, rollingFailureRatePercent: { type: Number, min: 1, max: 100, default: 10 } },
  retentionDays: { type: Number, default: 730, immutable: true, min: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });
configSchema.index({ version: 1 }, { unique: true });
configSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
export default mongoose.models.TranslationOperationalConfig || mongoose.model('TranslationOperationalConfig', configSchema);
