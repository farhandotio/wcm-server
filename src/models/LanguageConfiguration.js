import mongoose from 'mongoose';

export const LANGUAGE_LIFECYCLE_STATUSES = Object.freeze(['registered', 'backfilling', 'ready', 'published', 'disabled']);

const historySchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now, required: true },
}, { _id: false });

const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, lowercase: true, trim: true, immutable: true },
  name: { type: String, required: true, trim: true },
  nativeName: { type: String, required: true, trim: true },
  direction: { type: String, enum: ['ltr', 'rtl'], required: true, default: 'ltr' },
  isSource: { type: Boolean, required: true, default: false, immutable: true },
  status: { type: String, enum: LANGUAGE_LIFECYCLE_STATUSES, required: true, default: 'registered', index: true },
  catalogVersion: { type: String, required: true, trim: true, default: '1' },
  backfillOperationId: { type: String, trim: true, default: null, index: true },
  enabledAt: { type: Date, default: null }, readyAt: { type: Date, default: null }, publishedAt: { type: Date, default: null },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

export default mongoose.models.LanguageConfiguration || mongoose.model('LanguageConfiguration', schema);
