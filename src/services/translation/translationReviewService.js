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
  return runTranslationPersistenceTransaction((session) =>
    transitionTranslationState(
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
      { session }
    )
  );
};
