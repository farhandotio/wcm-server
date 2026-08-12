import mongoose from 'mongoose';
import { getStaticPageDefinition } from '../config/staticPageRegistry.js';
import { isSupportedLanguageCode } from '../config/supportedLanguages.js';

const staticPageTranslationSchema = new mongoose.Schema({
  pageKey: { type: String, required: true, trim: true, immutable: true },
  languageCode: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    immutable: true,
    validate: isSupportedLanguageCode,
  },
  content: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['draft', 'published'], default: 'draft', required: true },
}, { timestamps: true, minimize: false });

staticPageTranslationSchema.index(
  { pageKey: 1, languageCode: 1 },
  { unique: true, name: 'one_static_page_translation_per_language' }
);

staticPageTranslationSchema.pre('validate', function validatePageAndLanguage() {
  if (!getStaticPageDefinition(this.pageKey)) this.invalidate('pageKey', 'Unknown static page');
});

export default mongoose.models.StaticPageTranslation ||
  mongoose.model('StaticPageTranslation', staticPageTranslationSchema);
