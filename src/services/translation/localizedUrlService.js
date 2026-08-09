import slugify from 'slugify';
import Blog from '../../models/Blog.js';
import Category from '../../models/Category.js';
import Collection from '../../models/Collection.js';
import Listing from '../../models/Listing.js';
import LocalizedUrlRedirect from '../../models/LocalizedUrlRedirect.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import User from '../../models/User.js';
import {
  getBusinessObjectDefinition,
  isSupportedBusinessObjectType,
} from '../../config/businessObjectRegistry.js';
import {
  DEFAULT_LANGUAGE_CODE,
  getEnabledLanguages,
  isSupportedLanguageCode,
  normalizeLanguageCode,
} from '../../config/supportedLanguages.js';
import {
  runTranslationPersistenceTransaction,
  transitionTranslationState,
} from './translationService.js';

const ROUTE_SEGMENTS = Object.freeze({
  listing: 'listings',
  creatorProfile: 'profile',
  blog: 'blogs',
  category: 'categories',
  collection: 'collections',
});

const OBJECT_MODELS = Object.freeze({
  listing: Listing,
  creatorProfile: User,
  category: Category,
  collection: Collection,
  blog: Blog,
});

const PUBLIC_OBJECT_FILTERS = Object.freeze({
  listing: { status: 'approved' },
  creatorProfile: { role: 'creator', status: 'active' },
  collection: { isActive: true },
  blog: { status: 'published' },
});

const createUrlError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const applySession = (query, session) => (session ? query.session(session) : query);

const normalizeBaseUrl = (baseUrl) =>
  typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, '') : null;

export const normalizeLocalizedSlug = (value) =>
  slugify(typeof value === 'string' ? value : '', { lower: true, strict: true, trim: true });

const validateUrlScope = (businessObjectType, languageCode) => {
  const normalizedLanguageCode = normalizeLanguageCode(languageCode);
  const definition = getBusinessObjectDefinition(businessObjectType);

  if (!isSupportedBusinessObjectType(businessObjectType)) {
    throw createUrlError('UNSUPPORTED_BUSINESS_OBJECT', 'Unsupported business object type');
  }
  if (!isSupportedLanguageCode(normalizedLanguageCode)) {
    throw createUrlError('UNSUPPORTED_LANGUAGE', 'Unsupported language code');
  }
  if (!definition.supportsLocalizedSlug) {
    throw createUrlError('LOCALIZED_SLUG_UNSUPPORTED', 'Business object does not support localized slugs');
  }

  return normalizedLanguageCode;
};

export const assertLocalizedSlugAvailable = async (
  { businessObjectType, languageCode, slug, excludeTranslationRecordId = null },
  { session = null, translationRecordModel = TranslationRecord, redirectModel = LocalizedUrlRedirect } = {}
) => {
  const normalizedLanguageCode = validateUrlScope(businessObjectType, languageCode);
  const normalizedSlug = normalizeLocalizedSlug(slug);
  if (!normalizedSlug) {
    throw createUrlError('INVALID_LOCALIZED_SLUG', 'Slug must contain at least one letter or number');
  }

  const currentFilter = {
    businessObjectType,
    languageCode: normalizedLanguageCode,
    normalizedSlug,
    ...(excludeTranslationRecordId ? { _id: { $ne: excludeTranslationRecordId } } : {}),
  };
  const redirectFilter = {
    businessObjectType,
    languageCode: normalizedLanguageCode,
    normalizedOldSlug: normalizedSlug,
  };
  const [current, historical] = await Promise.all([
    applySession(translationRecordModel.exists(currentFilter), session),
    applySession(redirectModel.exists(redirectFilter), session),
  ]);

  if (current || historical) {
    throw createUrlError(
      historical ? 'LOCALIZED_SLUG_PERMANENTLY_RESERVED' : 'LOCALIZED_SLUG_CONFLICT',
      historical ? 'Slug is permanently reserved by redirect history' : 'Slug is already in use'
    );
  }

  return normalizedSlug;
};

export const generateLocalizedSlug = async (
  { businessObjectType, languageCode, value, excludeTranslationRecordId = null },
  options = {}
) => {
  const baseSlug = normalizeLocalizedSlug(value);
  if (!baseSlug) {
    throw createUrlError('INVALID_LOCALIZED_SLUG', 'Slug must contain at least one letter or number');
  }

  let suffix = 1;
  while (suffix < 10000) {
    const candidate = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
    try {
      return await assertLocalizedSlugAvailable(
        { businessObjectType, languageCode, slug: candidate, excludeTranslationRecordId },
        options
      );
    } catch (error) {
      if (!['LOCALIZED_SLUG_CONFLICT', 'LOCALIZED_SLUG_PERMANENTLY_RESERVED'].includes(error.code)) {
        throw error;
      }
      suffix += 1;
    }
  }

  throw createUrlError('LOCALIZED_SLUG_EXHAUSTED', 'Could not generate an available slug');
};

export const buildLocalizedPath = ({ businessObjectType, languageCode, slug }) => {
  const normalizedLanguageCode = validateUrlScope(businessObjectType, languageCode);
  const normalizedSlug = normalizeLocalizedSlug(slug);
  if (!normalizedSlug) {
    throw createUrlError('INVALID_LOCALIZED_SLUG', 'Slug must contain at least one letter or number');
  }

  const languagePrefix = normalizedLanguageCode === DEFAULT_LANGUAGE_CODE
    ? ''
    : `/${normalizedLanguageCode}`;
  if (businessObjectType === 'cms') {
    return `${languagePrefix}/${normalizedSlug}` || '/';
  }

  const segment = ROUTE_SEGMENTS[businessObjectType];
  if (!segment) {
    throw createUrlError('LOCALIZED_ROUTE_UNSUPPORTED', 'No public route is configured for this object type');
  }
  return `${languagePrefix}/${segment}/${normalizedSlug}`;
};

const findPublicObjectById = async (businessObjectType, businessObjectId) => {
  const model = OBJECT_MODELS[businessObjectType];
  if (!model) {
    return null;
  }
  return model.findOne({
    _id: businessObjectId,
    ...(PUBLIC_OBJECT_FILTERS[businessObjectType] || {}),
  }).lean();
};

const findSourceObjectBySlug = async (businessObjectType, slug) => {
  const model = OBJECT_MODELS[businessObjectType];
  if (!model?.schema.path('slug')) {
    return null;
  }
  return model.findOne({
    slug,
    ...(PUBLIC_OBJECT_FILTERS[businessObjectType] || {}),
  }).lean();
};

export const resolveSlugRedirect = async ({ businessObjectType, languageCode, slug }) => {
  const normalizedLanguageCode = validateUrlScope(businessObjectType, languageCode);
  const normalizedSlug = normalizeLocalizedSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const redirect = await LocalizedUrlRedirect.findOne({
    businessObjectType,
    languageCode: normalizedLanguageCode,
    normalizedOldSlug: normalizedSlug,
  }).lean();
  if (!redirect) {
    return null;
  }

  return {
    businessObjectType,
    businessObjectId: redirect.businessObjectId,
    languageCode: normalizedLanguageCode,
    fromSlug: redirect.oldSlug,
    targetSlug: redirect.targetSlug,
    statusCode: redirect.statusCode,
    location: buildLocalizedPath({
      businessObjectType,
      languageCode: normalizedLanguageCode,
      slug: redirect.targetSlug,
    }),
  };
};

export const resolveLocalizedSlug = async ({ businessObjectType, languageCode, slug }) => {
  const normalizedLanguageCode = validateUrlScope(businessObjectType, languageCode);
  const normalizedSlug = normalizeLocalizedSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const localizedRecord = await TranslationRecord.findOne({
    businessObjectType,
    languageCode: normalizedLanguageCode,
    normalizedSlug,
    publicationStatus: 'published',
    businessObjectDeletedAt: null,
  })
    .select('businessObjectType businessObjectId languageCode content slug seo translationStatus publicationStatus reviewLevel versionNumber')
    .lean();
  if (localizedRecord) {
    const object = await findPublicObjectById(businessObjectType, localizedRecord.businessObjectId);
    if (object) {
      return {
        businessObjectType,
        businessObjectId: localizedRecord.businessObjectId,
        languageCode: normalizedLanguageCode,
        slug: localizedRecord.slug,
        object,
        translation: localizedRecord,
        fallback: false,
      };
    }
  }

  const sourceObject = await findSourceObjectBySlug(businessObjectType, normalizedSlug);
  if (sourceObject) {
    return {
      businessObjectType,
      businessObjectId: sourceObject._id,
      languageCode: normalizedLanguageCode,
      slug: normalizedSlug,
      object: sourceObject,
      translation: null,
      fallback: normalizedLanguageCode !== DEFAULT_LANGUAGE_CODE,
    };
  }

  return null;
};

export const recordSlugRedirect = async (
  {
    businessObjectType,
    businessObjectId,
    languageCode,
    oldSlug,
    targetSlug,
    statusCode = 301,
    changedBy = null,
  },
  { session = null } = {}
) => {
  const normalizedLanguageCode = validateUrlScope(businessObjectType, languageCode);
  const normalizedOldSlug = normalizeLocalizedSlug(oldSlug);
  const normalizedTargetSlug = normalizeLocalizedSlug(targetSlug);
  if (!normalizedOldSlug || !normalizedTargetSlug || normalizedOldSlug === normalizedTargetSlug) {
    throw createUrlError('INVALID_LOCALIZED_REDIRECT', 'Redirect source and target must be different valid slugs');
  }

  await LocalizedUrlRedirect.updateMany(
    {
      businessObjectType,
      languageCode: normalizedLanguageCode,
      normalizedTargetSlug: normalizedOldSlug,
    },
    {
      $set: {
        targetSlug: normalizedTargetSlug,
        normalizedTargetSlug,
        statusCode,
        changedBy,
      },
    },
    { session, runValidators: true }
  );

  const [redirect] = await LocalizedUrlRedirect.create(
    [{
      businessObjectType,
      businessObjectId,
      languageCode: normalizedLanguageCode,
      oldSlug: normalizedOldSlug,
      targetSlug: normalizedTargetSlug,
      statusCode,
      changedBy,
    }],
    { session }
  );
  return redirect;
};

export const changeLocalizedSlug = async ({
  translationRecordId,
  slug,
  expectedVersion,
  actor,
  actorRole,
  statusCode = 301,
}) => runTranslationPersistenceTransaction(async (session) => {
  const record = await TranslationRecord.findById(translationRecordId)
    .select('+normalizedSlug')
    .session(session);
  if (!record) {
    throw createUrlError('TRANSLATION_NOT_FOUND', 'Translation record not found');
  }
  if (record.languageCode === DEFAULT_LANGUAGE_CODE) {
    throw createUrlError('SOURCE_SLUG_MANAGED_BY_OBJECT', 'Source-language slug is managed by its business object');
  }
  if (!record.slug) {
    throw createUrlError('LOCALIZED_SLUG_MISSING', 'Translation does not have a current slug');
  }
  if (record.publicationStatus !== 'published') {
    throw createUrlError('TRANSLATION_NOT_PUBLISHED', 'Only published localized slugs can be changed');
  }

  const nextSlug = await assertLocalizedSlugAvailable(
    {
      businessObjectType: record.businessObjectType,
      languageCode: record.languageCode,
      slug,
      excludeTranslationRecordId: record._id,
    },
    { session }
  );
  if (nextSlug === record.normalizedSlug) {
    return { record, version: null, redirect: null };
  }

  const previousSlug = record.slug;
  const { record: updatedRecord, version } = await transitionTranslationState(
    {
      translationRecordId: record._id,
      expectedVersion: expectedVersion ?? null,
      changes: { slug: nextSlug },
      modificationSource: actorRole === 'admin' ? 'administrator' : 'creator',
      actor,
      actorSnapshot: { role: actorRole },
      eventType: 'translation.slug_changed',
      details: { previousSlug, nextSlug, statusCode },
    },
    { session }
  );
  const redirect = await recordSlugRedirect(
    {
      businessObjectType: record.businessObjectType,
      businessObjectId: record.businessObjectId,
      languageCode: record.languageCode,
      oldSlug: previousSlug,
      targetSlug: nextSlug,
      statusCode,
      changedBy: actor,
    },
    { session }
  );

  return { record: updatedRecord, version, redirect };
});

export const getLanguageAlternates = async ({ businessObjectType, businessObjectId }) => {
  const sourceModel = OBJECT_MODELS[businessObjectType];
  const sourceObject = sourceModel?.schema.path('slug')
    ? await sourceModel.findOne({
        _id: businessObjectId,
        ...(PUBLIC_OBJECT_FILTERS[businessObjectType] || {}),
      }).select('slug').lean()
    : null;
  const records = await TranslationRecord.find({
    businessObjectType,
    businessObjectId,
    publicationStatus: 'published',
    businessObjectDeletedAt: null,
    slug: { $ne: null },
  }).select('languageCode slug').lean();

  const slugsByLanguage = new Map(records.map((record) => [record.languageCode, record.slug]));
  if (sourceObject?.slug) {
    slugsByLanguage.set(DEFAULT_LANGUAGE_CODE, sourceObject.slug);
  }

  return getEnabledLanguages().flatMap(({ code }) => {
    const localizedSlug = slugsByLanguage.get(code);
    return localizedSlug
      ? [{
          languageCode: code,
          slug: localizedSlug,
          path: buildLocalizedPath({ businessObjectType, languageCode: code, slug: localizedSlug }),
        }]
      : [];
  });
};

export const formatLocalizedMetadata = ({ alternates, languageCode, baseUrl }) => {
  const normalizedLanguageCode = normalizeLanguageCode(languageCode);
  if (!isSupportedLanguageCode(normalizedLanguageCode)) {
    throw createUrlError('UNSUPPORTED_LANGUAGE', 'Unsupported language code');
  }
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw createUrlError('CANONICAL_BASE_URL_REQUIRED', 'Canonical base URL is required');
  }

  const english = alternates.find(({ languageCode: code }) => code === DEFAULT_LANGUAGE_CODE);
  if (!english) {
    return null;
  }
  const requested = alternates.find(({ languageCode: code }) => code === normalizedLanguageCode);
  const canonical = requested || english;
  const languages = Object.fromEntries(
    alternates.map(({ languageCode: code, path }) => [code, `${normalizedBaseUrl}${path}`])
  );

  return {
    canonical: `${normalizedBaseUrl}${canonical.path}`,
    languages: { ...languages, 'x-default': `${normalizedBaseUrl}${english.path}` },
  };
};

export const buildLocalizedMetadata = async ({
  businessObjectType,
  businessObjectId,
  languageCode,
  baseUrl,
}) => {
  const alternates = await getLanguageAlternates({ businessObjectType, businessObjectId });
  return formatLocalizedMetadata({ alternates, languageCode, baseUrl });
};
