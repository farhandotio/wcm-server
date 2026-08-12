import { getEnabledLanguageConfigurations } from './languageConfigurationService.js';
import {
  markObjectTranslationsOutdated,
  requestBulkTranslations,
} from './translationEngine.js';
import { getCmsPageDefinition } from '../../config/businessObjectRegistry.js';

const CMS_FIXED_FIELDS = new Set([
  '_id',
  '__v',
  'createdAt',
  'updatedAt',
  'pageName',
  'id',
  'stepNumber',
  'href',
  'styleSettings',
  'socialLinks',
  'gridImages',
  'mainImage',
  'imageUrl',
  'iconId',
]);

const toCmsTranslatableValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(toCmsTranslatableValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !CMS_FIXED_FIELDS.has(key))
        .map(([key, nestedValue]) => [key, toCmsTranslatableValue(nestedValue)])
    );
  }

  return value;
};

export const buildCmsTranslatableContent = (document) => {
  const plainDocument = typeof document?.toObject === 'function'
    ? document.toObject({ versionKey: false })
    : document;

  return { content: toCmsTranslatableValue(plainDocument) };
};

export const triggerCmsTranslations = async ({
  cmsKey,
  document,
  adminId = null,
  sourceChanged = false,
}) => {
  if (!getCmsPageDefinition(cmsKey)) {
    const error = new Error(`Unsupported CMS page: ${cmsKey}`);
    error.code = 'UNSUPPORTED_CMS_PAGE';
    throw error;
  }

  const sourceVersion = document.updatedAt.getTime();

  if (sourceChanged) {
    await markObjectTranslationsOutdated({
      businessObjectType: 'cms',
      businessObjectId: document._id,
      sourceVersion,
    });
  }

  return requestBulkTranslations(
    (await getEnabledLanguageConfigurations())
      .filter(({ isSource }) => !isSource)
      .map(({ code }) => ({
        businessObjectType: 'cms',
        businessObjectId: document._id,
        targetLanguageCode: code,
        sourceVersion,
        sourceContent: buildCmsTranslatableContent(document),
        context: {
          cmsKey,
          ...(adminId ? { requestedBy: adminId, requestedByRole: 'admin' } : {}),
        },
      }))
  );
};
