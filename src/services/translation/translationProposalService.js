import TranslationProposal from '../../models/TranslationProposal.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import { listApplicableTerminology } from './translationTerminologyService.js';
import { validateAiTranslation } from './translationValidator.js';
import {
  runTranslationPersistenceTransaction,
  upsertTranslation,
} from './translationService.js';
import { recordTranslationEvent } from './translationAuditService.js';
import { resolvePublishingPolicy } from './publishingWorkflowService.js';
import { reopenReviewTaskForRecord } from './translationReviewTaskService.js';

const assertActiveProposal = (proposal, now = new Date()) => {
  if (!proposal || proposal.status !== 'active') {
    const error = new Error('Active translation proposal not found');
    error.code = 'TRANSLATION_PROPOSAL_NOT_FOUND';
    throw error;
  }
  if (proposal.expiresAt <= now) {
    const error = new Error('Translation proposal has expired');
    error.code = 'TRANSLATION_PROPOSAL_EXPIRED';
    throw error;
  }
};

export const createTranslationProposal = async (
  {
    businessObjectType,
    businessObjectId,
    languageCode,
    sourceVersion,
    sourceContent,
    proposedContent,
    proposedSlug = null,
    proposedSeo = {},
    metadata = {},
    jobId = null,
    requestedBy,
    requestedByRole,
  },
  { session = null } = {}
) => {
  const record = await TranslationRecord.findOne({
    businessObjectType,
    businessObjectId,
    languageCode,
  }).session(session);
  if (!record) {
    const error = new Error('A current translation is required before regeneration');
    error.code = 'TRANSLATION_NOT_FOUND';
    throw error;
  }
  if (record.metadata.sourceVersion !== sourceVersion) {
    const error = new Error('Regeneration source version is stale');
    error.code = 'STALE_TRANSLATION_JOB';
    throw error;
  }

  const [proposal] = await TranslationProposal.create(
    [
      {
        translationRecordId: record._id,
        businessObjectType,
        businessObjectId,
        languageCode,
        sourceVersion,
        expectedTranslationVersion: record.versionNumber,
        sourceContent,
        proposedContent,
        proposedSlug,
        proposedSeo,
        metadata,
        jobId,
        requestedBy,
        requestedByRole,
      },
    ],
    { session }
  );

  await recordTranslationEvent(
    {
      eventType: 'translation.proposal_created',
      outcome: 'success',
      businessObjectType,
      businessObjectId,
      languageCode,
      translationRecordId: record._id,
      actorType: requestedByRole,
      actor: requestedBy,
      actorSnapshot: { role: requestedByRole },
      jobId,
      details: { proposalId: proposal._id, sourceVersion },
    },
    { session }
  );
  return proposal;
};

export const getActiveTranslationProposal = ({
  translationRecordId,
  requestedBy,
  now = new Date(),
}) =>
  TranslationProposal.findOne({
    translationRecordId,
    requestedBy,
    status: 'active',
    expiresAt: { $gt: now },
  }).lean();

export const acceptTranslationProposal = async ({
  proposalId,
  actorId,
  actorRole,
  action = 'replace',
  mergedContent = null,
  expectedVersion = null,
}) => {
  if (!['admin', 'creator'].includes(actorRole)) {
    throw new Error('Only Admin or Creator can accept a translation proposal');
  }
  if (!['replace', 'manual_merge'].includes(action)) {
    throw new Error('Proposal action must be replace or manual_merge');
  }

  const proposal = await TranslationProposal.findById(proposalId);
  assertActiveProposal(proposal);
  const translatedContent = action === 'manual_merge' ? mergedContent : proposal.proposedContent;
  if (!translatedContent) {
    throw new Error('Merged translation content is required');
  }
  const terminology = await listApplicableTerminology({
    sourceLanguageCode: 'en',
    targetLanguageCode: proposal.languageCode,
  });
  const validation = validateAiTranslation({
    businessObjectType: proposal.businessObjectType,
    sourceLanguageCode: 'en',
    targetLanguageCode: proposal.languageCode,
    sourceContent: proposal.sourceContent,
    translatedContent,
    ...terminology,
  });
  if (!validation.valid) {
    const error = new Error('Translation proposal failed validation');
    error.code = 'TRANSLATION_VALIDATION_FAILED';
    error.validationErrors = validation.errors;
    throw error;
  }

  return runTranslationPersistenceTransaction(async (session) => {
    const currentProposal = await TranslationProposal.findById(proposalId).session(session);
    assertActiveProposal(currentProposal);
    const current = await TranslationRecord.findById(currentProposal.translationRecordId).session(session);
    const requiredVersion = expectedVersion ?? currentProposal.expectedTranslationVersion;
    const result = await upsertTranslation(
      {
        businessObjectType: currentProposal.businessObjectType,
        businessObjectId: currentProposal.businessObjectId,
        languageCode: currentProposal.languageCode,
        content: translatedContent,
        slug: currentProposal.proposedSlug,
        seo: currentProposal.proposedSeo,
        translationStatus: actorRole === 'admin' ? 'admin_reviewed' : 'creator_reviewed',
        publicationStatus: 'published',
        reviewLevel: actorRole === 'admin' ? 'admin_reviewed' : 'creator_reviewed',
        metadata: {
          ...(current?.metadata?.toObject?.() || current?.metadata || {}),
          ...currentProposal.metadata,
          sourceVersion: currentProposal.sourceVersion,
          origin: actorRole === 'admin' ? 'administrator' : 'creator',
          lastReviewedAt: new Date(),
          reviewer: actorId,
          reviewerRole: actorRole,
          lastModifiedBy: actorId,
        },
        modificationSource: actorRole === 'admin' ? 'administrator' : 'creator',
        author: actorId,
        authorSnapshot: { role: actorRole },
        expectedVersion: requiredVersion,
        proposalId: currentProposal._id,
      },
      { session }
    );
    currentProposal.status = 'accepted';
    currentProposal.resolvedAt = new Date();
    currentProposal.resolvedBy = actorId;
    await currentProposal.save({ session });
    if (actorRole === 'admin') {
      const policy = await resolvePublishingPolicy({ businessObjectType: currentProposal.businessObjectType, languageCode: currentProposal.languageCode });
      if (policy.publicationMode === 'manual_review') {
        await reopenReviewTaskForRecord({ translationRecordId: currentProposal.translationRecordId, actorId, comment: 'AI proposal accepted' }, { session });
      }
    }
    return result;
  });
};

export const discardTranslationProposal = async ({
  proposalId,
  actorId,
  actorRole,
  status = 'discarded',
}) => {
  if (!['discarded', 'cancelled'].includes(status)) {
    throw new Error('Proposal resolution must be discarded or cancelled');
  }
  const proposal = await TranslationProposal.findById(proposalId);
  assertActiveProposal(proposal);
  proposal.status = status;
  proposal.resolvedAt = new Date();
  proposal.resolvedBy = actorId;
  await proposal.save();
  await recordTranslationEvent({
    eventType: `translation.proposal_${status}`,
    outcome: 'success',
    businessObjectType: proposal.businessObjectType,
    businessObjectId: proposal.businessObjectId,
    languageCode: proposal.languageCode,
    translationRecordId: proposal.translationRecordId,
    actorType: actorRole,
    actor: actorId,
    actorSnapshot: { role: actorRole },
    details: { proposalId: proposal._id },
  });
  return proposal;
};
