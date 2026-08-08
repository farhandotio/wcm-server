import TranslationRecord from '../../models/TranslationRecord.js';
import {
  getBusinessObjectDefinition,
  validateTranslatableContent,
} from '../../config/businessObjectRegistry.js';
import {
  SOURCE_LANGUAGE_CODE,
  isSupportedLanguageCode,
  normalizeLanguageCode,
} from '../../config/supportedLanguages.js';
import {
  enqueueBulkTranslationJobs,
  enqueueTranslationJob,
} from './translationQueueService.js';
import { validateAiTranslation } from './translationValidator.js';
import {
  runTranslationPersistenceTransaction,
  upsertTranslation,
} from './translationService.js';

const validateTranslationRequest = ({
  businessObjectType,
  sourceLanguageCode,
  targetLanguageCode,
  sourceVersion,
  sourceContent,
}) => {
  if (!getBusinessObjectDefinition(businessObjectType)) {
    throw new Error(`Unsupported business object type: ${businessObjectType}`);
  }

  if (!isSupportedLanguageCode(sourceLanguageCode) || !isSupportedLanguageCode(targetLanguageCode)) {
    throw new Error('Source and target languages must be enabled');
  }

  if (normalizeLanguageCode(sourceLanguageCode) === normalizeLanguageCode(targetLanguageCode)) {
    throw new Error('Source and target languages must be different');
  }

  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
    throw new Error('sourceVersion must be a positive integer');
  }

  const contentValidation = validateTranslatableContent(businessObjectType, sourceContent);
  if (!contentValidation.valid) {
    throw new Error(contentValidation.reason || 'Invalid translatable source content');
  }
};

export const requestTranslation = async ({
  businessObjectType,
  businessObjectId,
  sourceLanguageCode = SOURCE_LANGUAGE_CODE,
  targetLanguageCode,
  sourceVersion,
  sourceContent,
  context = {},
}) => {
  validateTranslationRequest({
    businessObjectType,
    sourceLanguageCode,
    targetLanguageCode,
    sourceVersion,
    sourceContent,
  });

  return enqueueTranslationJob({
    businessObjectType,
    businessObjectId,
    sourceLanguageCode,
    targetLanguageCode,
    sourceVersion,
    sourceContent,
    context,
  });
};

export const requestBulkTranslations = async (requests) => {
  const normalizedRequests = requests.map((request) => ({
    sourceLanguageCode: SOURCE_LANGUAGE_CODE,
    ...request,
  }));
  normalizedRequests.forEach(validateTranslationRequest);
  return enqueueBulkTranslationJobs(normalizedRequests);
};

export const regenerateTranslation = (request) => {
  const normalizedRequest = { sourceLanguageCode: SOURCE_LANGUAGE_CODE, ...request };
  validateTranslationRequest(normalizedRequest);
  return enqueueTranslationJob({ ...normalizedRequest, operation: 'regenerate' });
};

export const saveHumanImprovement = async ({
  businessObjectType,
  businessObjectId,
  sourceLanguageCode = SOURCE_LANGUAGE_CODE,
  targetLanguageCode,
  sourceVersion,
  sourceContent,
  translatedContent,
  actorId,
  actorRole,
}) => {
  if (!['admin', 'creator'].includes(actorRole)) {
    throw new Error('actorRole must be admin or creator');
  }

  const validation = validateAiTranslation({
    businessObjectType,
    sourceLanguageCode,
    targetLanguageCode,
    sourceContent,
    translatedContent,
  });

  if (!validation.valid) {
    const error = new Error('Human translation improvement failed validation');
    error.code = 'TRANSLATION_VALIDATION_FAILED';
    error.validationErrors = validation.errors;
    throw error;
  }

  return runTranslationPersistenceTransaction((session) =>
    upsertTranslation(
      {
        businessObjectType,
        businessObjectId,
        languageCode: targetLanguageCode,
        content: translatedContent,
        translationStatus: actorRole === 'admin' ? 'admin_reviewed' : 'creator_reviewed',
        publicationStatus: 'published',
        reviewLevel: actorRole === 'admin' ? 'admin_reviewed' : 'creator_reviewed',
        metadata: {
          provider: null,
          model: null,
          confidence: null,
          sourceVersion,
          sourceHash: null,
          promptVersion: null,
          memoryHit: false,
          origin: actorRole === 'admin' ? 'administrator' : 'creator',
          lastReviewedAt: new Date(),
          reviewer: actorId,
          reviewerRole: actorRole,
          lastModifiedBy: actorId,
        },
        modificationSource: actorRole === 'admin' ? 'administrator' : 'creator',
        author: actorId,
        authorSnapshot: { role: actorRole },
      },
      { session }
    )
  );
};

export const markObjectTranslationsOutdated = ({
  businessObjectType,
  businessObjectId,
  sourceVersion,
}) =>
  TranslationRecord.updateMany(
    {
      businessObjectType,
      businessObjectId,
      'metadata.sourceVersion': { $lt: sourceVersion },
      reviewLevel: { $in: ['creator_reviewed', 'admin_reviewed', 'verified'] },
      translationStatus: { $ne: 'outdated' },
    },
    { $set: { translationStatus: 'outdated' } }
  );

const deferredProposalError = () => {
  const error = new Error('Translation proposal workflow is deferred until its API workflow is implemented');
  error.code = 'TRANSLATION_PROPOSAL_WORKFLOW_NOT_AVAILABLE';
  throw error;
};

export const acceptTranslationProposal = deferredProposalError;
export const discardTranslationProposal = deferredProposalError;
export const rollbackTranslation = deferredProposalError;
