import mongoose from 'mongoose';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

const protectedTermSchema = new mongoose.Schema(
  {
    languageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
    },
    term: { type: String, required: true, trim: true },
    normalizedTerm: { type: String, required: true, select: false },
    caseSensitive: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

protectedTermSchema.index(
  { languageCode: 1, normalizedTerm: 1 },
  { unique: true, name: 'unique_protected_term_per_language' }
);

protectedTermSchema.pre('validate', function normalizeTerm() {
  if (this.term) {
    this.normalizedTerm = this.term.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  }
});

export default mongoose.models.ProtectedTerm || mongoose.model('ProtectedTerm', protectedTermSchema);
