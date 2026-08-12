import TranslationPublishingPolicy from '../../models/TranslationPublishingPolicy.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import { BUSINESS_OBJECT_TYPES } from '../../config/businessObjectRegistry.js';
import {
  runTranslationPersistenceTransaction,
  transitionTranslationState,
} from './translationService.js';
import { queueTranslationNotification } from './translationNotificationService.js';
import {
  completeTranslationReviewTask,
  createOrReopenManualReviewTask,
} from './translationReviewTaskService.js';

export const DEFAULT_PUBLISHING_POLICIES = Object.freeze({
  [BUSINESS_OBJECT_TYPES.LISTING]: Object.freeze({
    publicationMode: 'master_approval_gated',
    requiredMasterStatus: 'approved',
    creatorImprovementMode: 'immediate_publish',
    verifiedAdminOnly: true,
  }),
  [BUSINESS_OBJECT_TYPES.CREATOR_PROFILE]: Object.freeze({
    publicationMode: 'automatic',
    requiredMasterStatus: 'active',
    creatorImprovementMode: 'immediate_publish',
    verifiedAdminOnly: true,
  }),
  [BUSINESS_OBJECT_TYPES.CATEGORY]: Object.freeze({
    publicationMode: 'manual_review',
    requiredMasterStatus: null,
    creatorImprovementMode: 'manual_review',
    verifiedAdminOnly: true,
  }),
  [BUSINESS_OBJECT_TYPES.BLOG]: Object.freeze({
    publicationMode: 'manual_review',
    requiredMasterStatus: null,
    creatorImprovementMode: 'manual_review',
    verifiedAdminOnly: true,
  }),
  [BUSINESS_OBJECT_TYPES.FAQ]: Object.freeze({
    publicationMode: 'manual_review',
    requiredMasterStatus: null,
    creatorImprovementMode: 'manual_review',
    verifiedAdminOnly: true,
  }),
  [BUSINESS_OBJECT_TYPES.CMS]: Object.freeze({
    publicationMode: 'manual_review',
    requiredMasterStatus: null,
    creatorImprovementMode: 'manual_review',
    verifiedAdminOnly: true,
  }),
});

export const resolvePublishingPolicy = async ({ businessObjectType, languageCode }) => {
  const configured = await TranslationPublishingPolicy.findOne({
    businessObjectType,
    languageCode,
    isActive: true,
  }).lean();

  return configured || {
    businessObjectType,
    languageCode,
    version: 0,
    isDefault: true,
    ...DEFAULT_PUBLISHING_POLICIES[businessObjectType],
  };
};

export const resolveCreatorTrustPolicy = (businessObjectType) => ({
  canImprove: [BUSINESS_OBJECT_TYPES.LISTING, BUSINESS_OBJECT_TYPES.CREATOR_PROFILE].includes(
    businessObjectType
  ),
  improvementPublicationMode:
    DEFAULT_PUBLISHING_POLICIES[businessObjectType]?.creatorImprovementMode || 'manual_review',
  canSetVerified: false,
});

export const evaluateAutomaticPublication = ({ policy, masterState = {} }) => {
  if (policy.publicationMode === 'manual_review') {
    return { eligible: false, reason: 'MANUAL_REVIEW_REQUIRED' };
  }

  if (policy.businessObjectType === BUSINESS_OBJECT_TYPES.LISTING) {
    return masterState.status === policy.requiredMasterStatus
      ? { eligible: true, reason: null }
      : { eligible: false, reason: 'MASTER_NOT_APPROVED' };
  }

  if (policy.businessObjectType === BUSINESS_OBJECT_TYPES.CREATOR_PROFILE) {
    const eligible =
      masterState.status === 'active' &&
      masterState.role === 'creator' &&
      masterState.creatorRequestStatus === 'approved';
    return eligible
      ? { eligible: true, reason: null }
      : { eligible: false, reason: 'CREATOR_NOT_APPROVED' };
  }

  return policy.publicationMode === 'automatic'
    ? { eligible: true, reason: null }
    : { eligible: false, reason: 'MASTER_GATE_NOT_SATISFIED' };
};

const transitionWithOptionalNotification = async ({
  transition,
  notification = null,
}) =>
  runTranslationPersistenceTransaction(async (session) => {
    const result = await transition(session);
    if (notification) {
      await queueTranslationNotification(
        {
          ...notification,
          businessObjectType: result.record.businessObjectType,
          businessObjectId: result.record.businessObjectId,
          languageCode: result.record.languageCode,
          translationRecordId: result.record._id,
        },
        { session }
      );
    }
    return result;
  });

export const applyAutomaticPublication = async ({
  translationRecordId,
  masterState,
  expectedVersion = null,
  recipient = null,
}) => {
  const record = await TranslationRecord.findById(translationRecordId).lean();
  if (!record) {
    throw new Error('Translation record not found');
  }
  const policy = await resolvePublishingPolicy({
    businessObjectType: record.businessObjectType,
    languageCode: record.languageCode,
  });
  const decision = evaluateAutomaticPublication({ policy, masterState });
  if (!decision.eligible) {
    return { published: false, reason: decision.reason, policy };
  }

  const result = await transitionWithOptionalNotification({
    transition: (session) =>
      transitionTranslationState(
        {
          translationRecordId,
          expectedVersion,
          changes: { publicationStatus: 'published' },
          eventType: 'translation.published',
          details: { policyVersion: policy.version, automatic: true },
        },
        { session }
      ),
    notification: recipient ? { recipient, eventType: 'available' } : null,
  });
  return { published: true, policy, ...result };
};

export const applyAutomaticPublicationForObject = async ({
  businessObjectType,
  businessObjectId,
  masterState,
  recipient = null,
}) => {
  const records = await TranslationRecord.find({
    businessObjectType,
    businessObjectId,
    publicationStatus: 'draft',
    translationStatus: { $ne: 'failed' },
  })
    .select('_id versionNumber')
    .lean();

  return Promise.all(
    records.map((record) =>
      applyAutomaticPublication({
        translationRecordId: record._id,
        masterState,
        expectedVersion: record.versionNumber,
        recipient,
      })
    )
  );
};

export const submitForManualReview = async ({ translationRecordId, expectedVersion = null, actor = null }) => {
  const record = await TranslationRecord.findById(translationRecordId).lean();
  if (!record) throw Object.assign(new Error('Translation record not found'), { code: 'TRANSLATION_NOT_FOUND' });
  const policy = await resolvePublishingPolicy({ businessObjectType: record.businessObjectType, languageCode: record.languageCode });
  return runTranslationPersistenceTransaction(async (session) => {
    const result = await transitionTranslationState(
        {
          translationRecordId,
          expectedVersion,
          changes: { publicationStatus: 'draft' },
          eventType: 'translation.review_submitted',
        },
        { session });
    const task = await createOrReopenManualReviewTask({ record: result.record, policy, actor }, { session });
    return { ...result, task };
  });
};

export const approveTranslationPublication = async ({
  translationRecordId,
  expectedVersion = null,
  adminId,
  comment = null,
  recipient = null,
}) => {
  if (!adminId) {
    throw new Error('Admin actor is required');
  }

  const record = await TranslationRecord.findById(translationRecordId).lean();
  if (!record) {
    const error = new Error('Translation record not found');
    error.code = 'TRANSLATION_NOT_FOUND';
    throw error;
  }
  const policy = await resolvePublishingPolicy({
    businessObjectType: record.businessObjectType,
    languageCode: record.languageCode,
  });
  if (policy.publicationMode !== 'manual_review') {
    const error = new Error('Translation approval is only available for manual-review publishing policies');
    error.code = 'TRANSLATION_APPROVAL_NOT_APPLICABLE';
    throw error;
  }

  return runTranslationPersistenceTransaction(async (session) => {
    const taskId = await resolveOpenTaskId(translationRecordId, session);
    if (!taskId) throw Object.assign(new Error('Open translation review task not found'), { code: 'TRANSLATION_REVIEW_TASK_NOT_FOUND' });
    const result = await transitionTranslationState(
        {
          translationRecordId,
          expectedVersion,
          changes: {
            publicationStatus: 'published',
            translationStatus: 'admin_reviewed',
            reviewLevel: 'admin_reviewed',
          },
          modificationSource: 'administrator',
          actor: adminId,
          actorSnapshot: { role: 'admin' },
          eventType: 'translation.publication_approved',
          details: { comment },
        },
        { session });
    const task = await completeTranslationReviewTask({ taskId, actorId: adminId, outcome: 'approved', comment }, { session });
    if (recipient) await queueTranslationNotification({ recipient, eventType: 'available', businessObjectType: result.record.businessObjectType, businessObjectId: result.record.businessObjectId, languageCode: result.record.languageCode, translationRecordId: result.record._id }, { session });
    return { ...result, task };
  });
};

const resolveOpenTaskId = async (translationRecordId, session) => {
  const { default: TranslationReviewTask } = await import('../../models/TranslationReviewTask.js');
  const task = await TranslationReviewTask.findOne({ translationRecordId, status: { $in: ['pending', 'assigned', 'in_review', 'returned_for_modification'] } }).sort({ updatedAt: -1 }).session(session);
  return task?._id || null;
};

const completeManualReviewOutcome = async ({ translationRecordId, expectedVersion, adminId, comment, outcome }) =>
  runTranslationPersistenceTransaction(async (session) => {
    const taskId = await resolveOpenTaskId(translationRecordId, session);
    if (!taskId) throw Object.assign(new Error('Open translation review task not found'), { code: 'TRANSLATION_REVIEW_TASK_NOT_FOUND' });
    const result = await transitionTranslationState({
      translationRecordId, expectedVersion,
      changes: { translationStatus: outcome, publicationStatus: 'unpublished' },
      modificationSource: 'administrator', actor: adminId, actorSnapshot: { role: 'admin' },
      eventType: `translation.review_${outcome}`, details: { comment },
    }, { session });
    const task = await completeTranslationReviewTask({ taskId, actorId: adminId, outcome, comment }, { session });
    return { ...result, task };
  });

export const rejectTranslationReview = (args) => completeManualReviewOutcome({ ...args, outcome: 'rejected' });
export const returnTranslationForModification = (args) => completeManualReviewOutcome({ ...args, outcome: 'returned_for_modification' });

export const unpublishTranslation = ({
  translationRecordId,
  expectedVersion = null,
  adminId,
  reason = null,
}) =>
  transitionWithOptionalNotification({
    transition: (session) =>
      transitionTranslationState(
        {
          translationRecordId,
          expectedVersion,
          changes: { publicationStatus: 'unpublished' },
          modificationSource: 'administrator',
          actor: adminId,
          actorSnapshot: { role: 'admin' },
          eventType: 'translation.unpublished',
          details: { reason },
        },
        { session }
      ),
  });

export const archiveTranslation = ({
  translationRecordId,
  expectedVersion = null,
  adminId,
}) =>
  transitionWithOptionalNotification({
    transition: (session) =>
      transitionTranslationState(
        {
          translationRecordId,
          expectedVersion,
          changes: { publicationStatus: 'archived' },
          modificationSource: 'administrator',
          actor: adminId,
          actorSnapshot: { role: 'admin' },
          eventType: 'translation.archived',
        },
        { session }
      ),
  });

export const applyAdministrativeOverride = ({
  translationRecordId,
  expectedVersion = null,
  adminId,
  publicationStatus,
  reviewLevel,
  reason,
}) => {
  if (!adminId || !reason) {
    throw new Error('Admin actor and override reason are required');
  }

  return transitionWithOptionalNotification({
    transition: (session) =>
      transitionTranslationState(
        {
          translationRecordId,
          expectedVersion,
          changes: {
            ...(publicationStatus ? { publicationStatus } : {}),
            ...(reviewLevel ? { reviewLevel } : {}),
          },
          modificationSource: 'administrator',
          actor: adminId,
          actorSnapshot: { role: 'admin' },
          eventType: 'translation.administrative_override',
          details: { reason },
        },
        { session }
      ),
  });
};

export const createPublishingPolicyVersion = async ({
  businessObjectType,
  languageCode,
  publicationMode,
  requiredMasterStatus = null,
  creatorImprovementMode,
  adminId,
}) => {
  const latest = await TranslationPublishingPolicy.findOne({ businessObjectType, languageCode })
    .sort({ version: -1 })
    .select('version')
    .lean();
  return TranslationPublishingPolicy.create({
    businessObjectType,
    languageCode,
    version: (latest?.version || 0) + 1,
    publicationMode,
    requiredMasterStatus,
    creatorImprovementMode,
    createdBy: adminId,
    updatedBy: adminId,
  });
};

export const activatePublishingPolicyVersion = async (policyId, adminId) =>
  runTranslationPersistenceTransaction(async (session) => {
    const policy = await TranslationPublishingPolicy.findById(policyId).session(session);
    if (!policy) {
      throw new Error('Publishing policy not found');
    }
    await TranslationPublishingPolicy.updateMany(
      {
        businessObjectType: policy.businessObjectType,
        languageCode: policy.languageCode,
        isActive: true,
      },
      { $set: { isActive: false, activatedAt: null, updatedBy: adminId } },
      { session }
    );
    policy.isActive = true;
    policy.activatedAt = new Date();
    policy.updatedBy = adminId;
    await policy.save({ session });
    return policy;
  });
