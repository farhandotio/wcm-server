import crypto from 'crypto';
import Listing from '../../models/Listing.js';
import User from '../../models/User.js';
import TranslationJob from '../../models/TranslationJob.js';
import TranslationProposal from '../../models/TranslationProposal.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import { BUSINESS_OBJECT_TYPES } from '../../config/businessObjectRegistry.js';
import { SOURCE_LANGUAGE_CODE } from '../../config/supportedLanguages.js';
import { getEnabledLanguageConfigurations } from './languageConfigurationService.js';
import { regenerateTranslation } from './translationEngine.js';
import {
  acceptTranslationProposal,
  discardTranslationProposal,
} from './translationProposalService.js';
import { saveHumanReview } from './translationReviewService.js';
import { listTranslationVersions } from './translationVersionService.js';

export const CREATOR_TRANSLATABLE_OBJECT_TYPES = Object.freeze([
  BUSINESS_OBJECT_TYPES.LISTING,
  BUSINESS_OBJECT_TYPES.CREATOR_PROFILE,
]);
export const CREATOR_REGENERATION_LIMIT = 5;
export const CREATOR_REGENERATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const createOwnershipError = (message = 'Creator does not own this business object') => {
  const error = new Error(message);
  error.code = 'TRANSLATION_OWNERSHIP_DENIED';
  return error;
};

export const assertCreatorOwnsBusinessObject = async ({
  businessObjectType,
  businessObjectId,
  creatorId,
}) => {
  if (businessObjectType === BUSINESS_OBJECT_TYPES.BLOG) {
    throw createOwnershipError('Blog translations are Admin-only');
  }
  if (!CREATOR_TRANSLATABLE_OBJECT_TYPES.includes(businessObjectType)) {
    throw createOwnershipError('Creators can translate only their own Listing or Creator Profile');
  }

  if (businessObjectType === BUSINESS_OBJECT_TYPES.LISTING) {
    const listing = await Listing.findOne({ _id: businessObjectId, creatorId }).lean();
    if (!listing) {
      throw createOwnershipError();
    }
    return listing;
  }

  if (String(businessObjectId) !== String(creatorId)) {
    throw createOwnershipError();
  }
  const creator = await User.findOne({ _id: businessObjectId, role: 'creator' }).lean();
  if (!creator) {
    throw createOwnershipError();
  }
  return creator;
};

export const assertCreatorTranslationMutationAllowed = (creatorStatus) => {
  if (creatorStatus !== 'active') {
    const error = new Error('Account is restricted from translation mutations');
    error.code = 'ACCOUNT_RESTRICTED';
    throw error;
  }
};

export const extractCreatorSourceContent = (businessObjectType, object) => {
  if (businessObjectType === BUSINESS_OBJECT_TYPES.LISTING) {
    return { title: object.title, description: object.description };
  }
  if (businessObjectType === BUSINESS_OBJECT_TYPES.CREATOR_PROFILE) {
    return {
      name: object.profile?.displayName || object.profile?.businessName,
      bio: object.profile?.bio,
    };
  }
  throw createOwnershipError('Unsupported Creator translation object');
};

export const getCreatorTranslationWorkspace = async ({
  businessObjectType,
  businessObjectId,
  creatorId,
}) => {
  const object = await assertCreatorOwnsBusinessObject({
    businessObjectType,
    businessObjectId,
    creatorId,
  });
  const translations = await TranslationRecord.find({
    businessObjectType,
    businessObjectId,
  })
    .select('languageCode content slug translationStatus publicationStatus reviewLevel versionNumber updatedAt')
    .lean();

  return {
    businessObjectType,
    businessObjectId,
    sourceLanguageCode: SOURCE_LANGUAGE_CODE,
    sourceContent: extractCreatorSourceContent(businessObjectType, object),
    translations,
  };
};

export const resolveCreatorAvailabilityState = ({ record = null, job = null }) => {
  if (record?.publicationStatus === 'published') {
    return 'Available';
  }
  if (job && ['queued', 'processing', 'retry_scheduled'].includes(job.status)) {
    return 'Processing';
  }
  if (
    record?.translationStatus === 'failed' ||
    (job && ['failed', 'dead_letter'].includes(job.status))
  ) {
    return 'Needs attention';
  }
  return 'Not available';
};

export const listCreatorTranslationAvailability = async ({
  businessObjectType,
  businessObjectId,
  creatorId,
}) => {
  await assertCreatorOwnsBusinessObject({ businessObjectType, businessObjectId, creatorId });
  const targetLanguages = (await getEnabledLanguageConfigurations()).filter(({ isSource }) => !isSource);
  const [records, jobs] = await Promise.all([
    TranslationRecord.find({ businessObjectType, businessObjectId }).lean(),
    TranslationJob.find({ businessObjectType, businessObjectId })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return targetLanguages.map(({ code }) => {
    const record = records.find(({ languageCode }) => languageCode === code) || null;
    const job = jobs.find(({ targetLanguageCode }) => targetLanguageCode === code) || null;
    return {
      languageCode: code,
      state: resolveCreatorAvailabilityState({ record, job }),
      updatedAt: record?.updatedAt || job?.updatedAt || null,
    };
  });
};

export const saveCreatorImprovement = async ({
  businessObjectType,
  businessObjectId,
  creatorId,
  creatorStatus,
  targetLanguageCode,
  sourceVersion,
  translatedContent,
  expectedVersion,
}) => {
  assertCreatorTranslationMutationAllowed(creatorStatus);
  const object = await assertCreatorOwnsBusinessObject({
    businessObjectType,
    businessObjectId,
    creatorId,
  });
  return saveHumanReview({
    businessObjectType,
    businessObjectId,
    targetLanguageCode,
    sourceVersion,
    sourceContent: extractCreatorSourceContent(businessObjectType, object),
    translatedContent,
    expectedVersion,
    actorId: creatorId,
    actorRole: 'creator',
    notifyRecipient: creatorId,
  });
};

export const getCreatorRegenerationUsage = async ({
  businessObjectType,
  businessObjectId,
  languageCode,
  creatorId,
  now = new Date(),
}) => {
  const used = await TranslationJob.countDocuments({
    operation: 'regenerate',
    businessObjectType,
    businessObjectId,
    targetLanguageCode: languageCode,
    'context.requestedBy': creatorId,
    attemptCount: { $gt: 0 },
    createdAt: { $gte: new Date(now.getTime() - CREATOR_REGENERATION_WINDOW_MS) },
  });
  return { used, remaining: Math.max(CREATOR_REGENERATION_LIMIT - used, 0) };
};

export const requestCreatorRegeneration = async ({
  businessObjectType,
  businessObjectId,
  creatorId,
  creatorStatus,
  targetLanguageCode,
  sourceVersion,
}) => {
  assertCreatorTranslationMutationAllowed(creatorStatus);
  const object = await assertCreatorOwnsBusinessObject({
    businessObjectType,
    businessObjectId,
    creatorId,
  });
  const usage = await getCreatorRegenerationUsage({
    businessObjectType,
    businessObjectId,
    languageCode: targetLanguageCode,
    creatorId,
  });
  if (usage.remaining === 0) {
    const error = new Error('Creator regeneration limit reached');
    error.code = 'TRANSLATION_REGENERATION_LIMIT_REACHED';
    throw error;
  }

  const regenerationRequestId = crypto.randomUUID();
  const job = await regenerateTranslation({
    businessObjectType,
    businessObjectId,
    targetLanguageCode,
    sourceVersion,
    sourceContent: extractCreatorSourceContent(businessObjectType, object),
    idempotencyDiscriminator: regenerationRequestId,
    context: {
      requestedBy: creatorId,
      requestedByRole: 'creator',
      regenerationRequestId,
    },
  });
  return { job, remaining: usage.remaining };
};

export const acceptCreatorRegeneration = async ({
  proposalId,
  creatorId,
  creatorStatus,
  action,
  mergedContent = null,
  expectedVersion = null,
}) => {
  assertCreatorTranslationMutationAllowed(creatorStatus);
  const proposal = await TranslationProposal.findById(proposalId).lean();
  if (!proposal) {
    throw new Error('Translation proposal not found');
  }
  await assertCreatorOwnsBusinessObject({
    businessObjectType: proposal.businessObjectType,
    businessObjectId: proposal.businessObjectId,
    creatorId,
  });
  return acceptTranslationProposal({
    proposalId,
    actorId: creatorId,
    actorRole: 'creator',
    action,
    mergedContent,
    expectedVersion,
  });
};

export const discardCreatorRegeneration = async ({ proposalId, creatorId, creatorStatus }) => {
  assertCreatorTranslationMutationAllowed(creatorStatus);
  const proposal = await TranslationProposal.findById(proposalId).lean();
  if (!proposal) {
    throw new Error('Translation proposal not found');
  }
  await assertCreatorOwnsBusinessObject({
    businessObjectType: proposal.businessObjectType,
    businessObjectId: proposal.businessObjectId,
    creatorId,
  });
  return discardTranslationProposal({
    proposalId,
    actorId: creatorId,
    actorRole: 'creator',
  });
};

export const listCreatorTranslationVersions = async ({
  translationRecordId,
  businessObjectType,
  businessObjectId,
  creatorId,
}) => {
  await assertCreatorOwnsBusinessObject({ businessObjectType, businessObjectId, creatorId });
  const versions = await listTranslationVersions(translationRecordId);
  return versions.map((version) => ({
    versionNumber: version.versionNumber,
    sourceVersion: version.sourceVersion,
    authorType: version.authorSnapshot.role,
    createdAt: version.createdAt,
    previousContent: version.previousValue?.content || null,
    newContent: version.newValue.content,
  }));
};
