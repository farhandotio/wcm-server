import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  eventType: { type: String, required: true, trim: true, index: true },
  outcome: { type: String, enum: ['success', 'failure', 'info'], default: 'info', index: true },
  jobId: { type: String, default: null, trim: true, index: true },
  provider: { type: String, default: null, trim: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.TranslationOperationalLog || mongoose.model('TranslationOperationalLog', schema);
