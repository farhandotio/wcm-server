import LanguageConfiguration from '../../models/LanguageConfiguration.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import { SOURCE_LANGUAGE_CODE, normalizeLanguageCode } from '../../config/supportedLanguages.js';
import { getBusinessObjectDefinition } from '../../config/businessObjectRegistry.js';

const publicLanguageError = (message, code, status) => Object.assign(new Error(message), { code, status });
const serialize = (value) => typeof value?.toObject === 'function' ? value.toObject() : value;
const getPath = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
const setPath = (value, path, nextValue) => {
  const parts = path.split('.'); const leaf = parts.pop();
  const parent = parts.reduce((current, key) => {
    current[key] = current[key] && typeof current[key] === 'object' ? { ...current[key] } : {};
    return current[key];
  }, value);
  parent[leaf] = nextValue;
};
const mergeCmsContent = (master, translated) => {
  if (Array.isArray(master)) return master.map((item, index) => mergeCmsContent(item, translated?.[index]));
  if (!master || typeof master !== 'object') return typeof translated === 'string' ? translated : master;
  return Object.fromEntries(Object.entries(master).map(([key, value]) => [key, mergeCmsContent(value, translated?.[key])]));
};

export const resolvePublicLanguage = async (requestedLanguage) => {
  if (requestedLanguage === undefined || requestedLanguage === null || requestedLanguage === '') return SOURCE_LANGUAGE_CODE;
  const code = normalizeLanguageCode(requestedLanguage);
  if (!code) throw publicLanguageError('Invalid language code', 'INVALID_LANGUAGE', 400);
  const language = await LanguageConfiguration.findOne({ code, status: 'published' }).select('code').lean();
  if (!language) throw publicLanguageError('Language is not published', 'LANGUAGE_NOT_PUBLISHED', 404);
  return code;
};

export const projectLocalizedObjects = async ({ businessObjectType, objects, language }) => {
  const code = await resolvePublicLanguage(language);
  const values = objects.map(serialize);
  if (code === SOURCE_LANGUAGE_CODE || values.length === 0) return values;
  const definition = getBusinessObjectDefinition(businessObjectType);
  const translations = await TranslationRecord.find({
    businessObjectType,
    businessObjectId: { $in: values.map(({ _id }) => _id) },
    languageCode: code,
    publicationStatus: 'published',
  }).select('businessObjectId content slug seo').lean();
  const byId = new Map(translations.map((record) => [String(record.businessObjectId), record]));
  return values.map((value) => {
    const record = byId.get(String(value._id));
    if (!record) return value;
    if (businessObjectType === 'cms') return mergeCmsContent(value, record.content?.content || {});
    const projected = { ...value };
    for (const [field, translatedValue] of Object.entries(record.content || {})) {
      const alias = definition?.fieldAliases?.[field] || field;
      const target = Array.isArray(alias) ? alias.find((path) => getPath(projected, path) != null) : alias;
      if (!target || translatedValue === undefined || translatedValue === null || translatedValue === '') continue;
      setPath(projected, target, translatedValue);
    }
    if (record.slug) projected.slug = record.slug;
    if (record.seo) projected._localizedSeo = record.seo;
    return projected;
  });
};

export const projectLocalizedObject = async (options) => (await projectLocalizedObjects({ ...options, objects: [options.object] }))[0];

export const resolveLocalizedBusinessObjectId = async ({ businessObjectType, slug, language }) => {
  const code = await resolvePublicLanguage(language);
  if (code === SOURCE_LANGUAGE_CODE) return null;
  const record = await TranslationRecord.findOne({ businessObjectType, languageCode: code, normalizedSlug: String(slug).toLowerCase(), publicationStatus: 'published' }).select('businessObjectId').lean();
  return record?.businessObjectId || null;
};

export const sendPublicLanguageError = (res, error) => res.status(error.status || 500).json({
  success: false,
  code: error.code || 'LOCALIZATION_FAILED',
  message: error.message,
});
