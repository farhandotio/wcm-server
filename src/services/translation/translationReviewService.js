import TranslationRecord from '../../models/TranslationRecord.js';
import { getTranslationVersion } from './translationVersionService.js';
import { listApplicableTerminology } from './translationTerminologyService.js';
import { validateAiTranslation } from './translationValidator.js';
import {
  runTranslationPersistenceTransaction,
  transitionTranslationState,
  upsertTranslation,
} from './translationService.js';
import { queueTranslationNotification } from './translationNotificationService.js';
import { resolvePublishingPolicy } from './publishingWorkflowService.js';
import { reopenReviewTaskForRecord } from './translationReviewTaskService.js';

export const saveHumanReview = async ({
  businessObjectType,
  businessObjectId,
  sourceLanguageCode = 'en',
  targetLanguageCode,
  sourceVersion,
  sourceContent,
  translatedContent,
  expectedVersion,
  actorId,
  actorRole,
  notifyRecipient = null,
}) => {
  if (!['admin', 'creator'].includes(actorRole)) {
    throw new Error('Only Admin or Creator can save a human review');
  }
  const terminology = await listApplicableTerminology({
    sourceLanguageCode,
    targetLanguageCode,
  });
  const validation = validateAiTranslation({
    businessObjectType,
    sourceLanguageCode,
    targetLanguageCode,
    sourceContent,
    translatedContent,
    ...terminology,
  });
  if (!validation.valid) {
    const error = new Error('Human translation improvement failed validation');
    error.code = 'TRANSLATION_VALIDATION_FAILED';
    error.validationErrors = validation.errors;
    throw error;
  }

  return runTranslationPersistenceTransaction(async (session) => {
    const current = await TranslationRecord.findOne({
      businessObjectType,
      businessObjectId,
      languageCode: targetLanguageCode,
    }).session(session);
    const result = await upsertTranslation(
      {
        businessObjectType,
        businessObjectId,
        languageCode: targetLanguageCode,
        content: translatedContent,
        translationStatus: actorRole === 'admin' ? 'admin_reviewed' : 'creator_reviewed',
        publicationStatus: 'published',
        reviewLevel: actorRole === 'admin' ? 'admin_reviewed' : 'creator_reviewed',
        metadata: {
          ...(current?.metadata?.toObject?.() || current?.metadata || {}),
          sourceVersion,
          origin: actorRole === 'admin' ? 'administrator' : 'creator',
          lastReviewedAt: new Date(),
          reviewer: actorId,
          reviewerRole: actorRole,
          lastModifiedBy: actorId,
        },
        modificationSource: actorRole === 'admin' ? 'administrator' : 'creator',
        author: actorId,
        authorSnapshot: { role: actorRole },
        expectedVersion,
      },
      { session }
    );
    if (notifyRecipient) {
      await queueTranslationNotification(
        {
          recipient: notifyRecipient,
          eventType: 'updated',
          businessObjectType,
          businessObjectId,
          languageCode: targetLanguageCode,
          translationRecordId: result.record._id,
        },
        { session }
      );
    }
    return result;
  });
};

export const saveAdminTranslationEdit = async ({
  translationRecordId,
  sourceLanguageCode = 'en',
  sourceContent,
  sourceVersion,
  translatedContent,
  seo,
  expectedVersion,
  adminId,
}) => {
  if (!adminId) {
    throw new Error('Admin actor is required to edit a translation');
  }

  const record = await TranslationRecord.findById(translationRecordId);
  if (!record) {
    const error = new Error('Translation record not found');
    error.code = 'TRANSLATION_NOT_FOUND';
    throw error;
  }

  const terminology = await listApplicableTerminology({
    sourceLanguageCode,
    targetLanguageCode: record.languageCode,
  });
  const validation = validateAiTranslation({
    businessObjectType: record.businessObjectType,
    sourceLanguageCode,
    targetLanguageCode: record.languageCode,
    sourceContent,
    translatedContent,
    ...terminology,
  });
  if (!validation.valid) {
    const error = new Error('Administrative translation edit failed validation');
    error.code = 'TRANSLATION_VALIDATION_FAILED';
    error.validationErrors = validation.errors;
    throw error;
  }

  const metadata = {
    ...(record.metadata?.toObject?.() || record.metadata || {}),
    sourceVersion,
    origin: 'administrator',
    lastReviewedAt: new Date(),
    reviewer: adminId,
    reviewerRole: 'admin',
    lastModifiedBy: adminId,
  };

  return runTranslationPersistenceTransaction(async (session) => {
    const result = await transitionTranslationState(
      {
        translationRecordId,
        expectedVersion,
        changes: {
          content: translatedContent,
          seo,
          translationStatus: 'admin_reviewed',
          reviewLevel: 'admin_reviewed',
          metadata,
        },
        modificationSource: 'administrator',
        actor: adminId,
        actorSnapshot: { role: 'admin' },
        eventType: 'translation.edited',
      },
      { session });
    const policy = await resolvePublishingPolicy({ businessObjectType: result.record.businessObjectType, languageCode: result.record.languageCode });
    if (policy.publicationMode === 'manual_review') await reopenReviewTaskForRecord({ translationRecordId, actorId: adminId, comment: 'Translation edited' }, { session });
    return result;
  });
};

export const setTranslationVerified = ({
  translationRecordId,
  expectedVersion,
  adminId,
}) => {
  if (!adminId) {
    throw new Error('Admin actor is required to verify a translation');
  }
  return runTranslationPersistenceTransaction((session) =>
    transitionTranslationState(
      {
        translationRecordId,
        expectedVersion,
        changes: { reviewLevel: 'verified', translationStatus: 'admin_reviewed' },
        modificationSource: 'administrator',
        actor: adminId,
        actorSnapshot: { role: 'admin' },
        eventType: 'translation.verified',
      },
      { session }
    )
  );
};

export const restoreTranslationVersion = async ({
  translationRecordId,
  versionNumber,
  expectedVersion,
  adminId,
}) => {
  if (!adminId) {
    throw new Error('Admin actor is required to rollback a translation');
  }
  const target = await getTranslationVersion(translationRecordId, versionNumber);
  if (!target) {
    throw new Error('Translation version not found');
  }
  return runTranslationPersistenceTransaction(async (session) => {
    const result = await transitionTranslationState(
      {
        translationRecordId,
        expectedVersion,
        changes: {
          content: target.newValue.content,
          slug: target.newValue.slug,
          seo: target.newValue.seo,
          translationStatus: target.newValue.translationStatus,
          publicationStatus: target.newValue.publicationStatus,
          reviewLevel: target.newValue.reviewLevel,
          metadata: target.newValue.metadata,
        },
        modificationSource: 'administrator',
        actor: adminId,
        actorSnapshot: { role: 'admin' },
        eventType: 'translation.rollback',
        rollbackFromVersion: versionNumber,
      },
      { session });
    const policy = await resolvePublishingPolicy({ businessObjectType: result.record.businessObjectType, languageCode: result.record.languageCode });
    if (policy.publicationMode === 'manual_review') await reopenReviewTaskForRecord({ translationRecordId, actorId: adminId, comment: `Restored version ${versionNumber}` }, { session });
    return result;
  });
};
