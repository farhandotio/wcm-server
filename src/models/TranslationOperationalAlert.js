import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  type: { type: String, required: true, trim: true, index: true },
  status: { type: String, enum: ['open', 'acknowledged', 'resolved'], default: 'open', index: true },
  severity: { type: String, enum: ['warning', 'critical'], required: true },
  summary: { type: String, required: true, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  dedupeKey: { type: String, required: true, unique: true, immutable: true },
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acknowledgedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true, minimize: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.TranslationOperationalAlert || mongoose.model('TranslationOperationalAlert', schema);
