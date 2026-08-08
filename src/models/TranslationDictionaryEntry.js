import mongoose from 'mongoose';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

const translationDictionaryEntrySchema = new mongoose.Schema(
  {
    sourceLanguageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
    },
    targetLanguageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: isSupportedLanguageCode,
    },
    sourceTerm: { type: String, required: true, trim: true },
    normalizedSourceTerm: { type: String, required: true, select: false },
    targetTerm: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

translationDictionaryEntrySchema.index(
  { sourceLanguageCode: 1, targetLanguageCode: 1, normalizedSourceTerm: 1 },
  { unique: true, name: 'unique_dictionary_term_per_language_pair' }
);

translationDictionaryEntrySchema.pre('validate', function normalizeSourceTerm() {
  if (this.sourceTerm) {
    this.normalizedSourceTerm = this.sourceTerm.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  }
});

export default mongoose.models.TranslationDictionaryEntry ||
  mongoose.model('TranslationDictionaryEntry', translationDictionaryEntrySchema);
