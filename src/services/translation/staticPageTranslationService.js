import LanguageConfiguration from '../../models/LanguageConfiguration.js';
import StaticPageTranslation from '../../models/StaticPageTranslation.js';
import {
  getStaticPageDefinition,
  listStaticPageDefinitions,
} from '../../config/staticPageRegistry.js';

const FIXED_VALUES = new Set([
  'World Culture Marketplace (WCM)',
  'contact@worldculturemarketplace.com',
]);

const normalizeLanguage = (value) => String(value || '').trim().toLowerCase();

const hasMatchingTextStructure = (source, value) => {
  if (typeof source === 'string') {
    return typeof value === 'string'
      && Boolean(value.trim())
      && (!FIXED_VALUES.has(source) || value === source);
  }
  if (Array.isArray(source)) {
    return Array.isArray(value)
      && value.length === source.length
      && source.every((item, index) => hasMatchingTextStructure(item, value[index]));
  }
  if (!source || typeof source !== 'object') return source === value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const sourceKeys = Object.keys(source);
  return sourceKeys.length === Object.keys(value).length
    && sourceKeys.every((key) => Object.hasOwn(value, key)
      && hasMatchingTextStructure(source[key], value[key]));
};

export const listStaticPages = () => listStaticPageDefinitions();

export const getStaticPageEditor = async ({ pageKey, languageCode }) => {
  const definition = getStaticPageDefinition(pageKey);
  const code = normalizeLanguage(languageCode);
  if (!definition || !code || code === 'en') return null;
  const [source, translation] = await Promise.all([
    StaticPageTranslation.findOne({ pageKey, languageCode: 'en', status: 'published' }).lean(),
    StaticPageTranslation.findOne({ pageKey, languageCode: code }).lean(),
  ]);
  if (!source?.content) return null;
  return {
    pageKey,
    label: definition.label,
    languageCode: code,
    sourceContent: source.content,
    translatedContent: translation?.content || null,
    status: translation?.status || 'draft',
    updatedAt: translation?.updatedAt || null,
  };
};

export const publishStaticPageTranslation = async ({ pageKey, languageCode, content }) => {
  const definition = getStaticPageDefinition(pageKey);
  const code = normalizeLanguage(languageCode);
  if (!definition || !code || code === 'en') {
    throw Object.assign(new Error('Static page or target language is invalid'), { code: 'INVALID_STATIC_PAGE_TRANSLATION' });
  }
  const source = await StaticPageTranslation.findOne({
    pageKey,
    languageCode: 'en',
    status: 'published',
  }).select('content').lean();
  if (!source?.content) {
    throw Object.assign(new Error('English static page source is not available'), { code: 'STATIC_PAGE_SOURCE_NOT_FOUND' });
  }
  if (!hasMatchingTextStructure(source.content, content)) {
    throw Object.assign(new Error('Translated content must match the English page structure'), { code: 'INVALID_STATIC_PAGE_CONTENT' });
  }
  return StaticPageTranslation.findOneAndUpdate(
    { pageKey, languageCode: code },
    { $set: { content, status: 'published' } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  ).lean();
};

export const getPublishedStaticPageTranslation = async ({ pageKey, languageCode }) => {
  if (!getStaticPageDefinition(pageKey)) return null;
  const code = normalizeLanguage(languageCode);
  if (!code) return null;
  if (code !== 'en') {
    const language = await LanguageConfiguration.exists({ code, status: 'published', isSource: false });
    if (!language) return null;
  }
  const record = await StaticPageTranslation.findOne({ pageKey, languageCode: code, status: 'published' }).lean();
  if (!record?.content) return null;
  return { pageKey, languageCode: code, content: record.content, updatedAt: record.updatedAt };
};

export { hasMatchingTextStructure };
