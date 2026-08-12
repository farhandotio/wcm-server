import crypto from 'crypto';
import ExcelJS from 'exceljs';
import TranslationPublishingPolicy from '../models/TranslationPublishingPolicy.js';
import TranslationRecord from '../models/TranslationRecord.js';
import { BUSINESS_OBJECT_TYPES } from '../config/businessObjectRegistry.js';
import {
  activatePublishingPolicyVersion,
  applyAdministrativeOverride,
  approveTranslationPublication,
  rejectTranslationReview as rejectTranslationReviewRecord,
  returnTranslationForModification as returnTranslationForModificationRecord,
  archiveTranslation as archiveTranslationRecord,
  createPublishingPolicyVersion,
  resolveCreatorTrustPolicy,
  unpublishTranslation as unpublishTranslationRecord,
} from '../services/translation/publishingWorkflowService.js';
import TranslationRole, { TRANSLATION_PERMISSIONS } from '../models/TranslationRole.js';
import {
  assignTranslationReviewTask,
  claimTranslationReviewTask,
  listManualReviewTasks,
} from '../services/translation/translationReviewTaskService.js';
import { getTranslationPermissionsForUser } from '../services/translation/translationPermissionService.js';
import {
  listTranslationNotifications,
  markTranslationNotificationRead,
  updateTranslationNotificationPreferences,
} from '../services/translation/translationNotificationService.js';
import {
  restoreTranslationVersion,
  saveAdminTranslationEdit,
  setTranslationVerified,
} from '../services/translation/translationReviewService.js';
import {
  getBulkOperationSummary,
  getTranslationDashboard as getDashboard,
  getTranslationOperationalExportData,
  getTranslationRecordDetails as getDetails,
  getTranslationRecordsForBulk,
  listBulkOperationJobs,
  searchTranslationRecords as searchRecords,
} from '../services/translation/translationCentreService.js';
import { getSourceContentForObject } from '../services/translation/translationSourceContentService.js';
import {
  acquireEditLock,
  assertEditLock,
  refreshEditLock,
  releaseEditLock,
} from '../services/translation/translationLockService.js';
import { regenerateTranslation, requestBulkTranslations } from '../services/translation/translationEngine.js';
import {
  acceptTranslationProposal,
  discardTranslationProposal,
} from '../services/translation/translationProposalService.js';
import {
  cancelTranslationJob,
  retryDeadLetterTranslationJob,
} from '../services/translation/translationQueueService.js';
import { getTranslationOperationalHealth } from '../services/translation/translationHealthService.js';
import { listTranslationOperationalLogs } from '../services/translation/translationOperationalLogService.js';
import { evaluateOperationalAlerts, listOperationalAlerts, updateOperationalAlert } from '../services/translation/translationAlertService.js';
import { activateConfigurationVersion, createConfigurationVersion, getActiveTranslationConfiguration } from '../services/translation/translationConfigurationService.js';
import TranslationOperationalConfig from '../models/TranslationOperationalConfig.js';
import TranslationPrompt from '../models/TranslationPrompt.js';
import TranslationDictionaryEntry from '../models/TranslationDictionaryEntry.js';
import ProtectedTerm from '../models/ProtectedTerm.js';
import { activatePromptVersion, createPromptVersion } from '../services/translation/promptService.js';
import { archiveMemoryEntry, listMemoryEntries, updateMemoryEntry } from '../services/translation/translationMemoryService.js';
import { normalizeTerminologyFields } from '../services/translation/translationTerminologyService.js';
import {
  getStaticPageEditor,
  listStaticPages,
  publishStaticPageTranslation,
} from '../services/translation/staticPageTranslationService.js';

const sendError = (res, error) => {
  const statusByCode = {
    TRANSLATION_NOT_FOUND: 404,
    TRANSLATION_SOURCE_NOT_FOUND: 404,
    TRANSLATION_PROPOSAL_NOT_FOUND: 404,
    TRANSLATION_VERSION_CONFLICT: 409,
    TRANSLATION_EDIT_LOCKED: 409,
    TRANSLATION_EDIT_LOCK_NOT_HELD: 409,
    TRANSLATION_APPROVAL_NOT_APPLICABLE: 409,
    TRANSLATION_REVIEW_TASK_NOT_FOUND: 404,
    TRANSLATION_REVIEW_TASK_CLOSED: 409,
    STALE_TRANSLATION_JOB: 409,
    BULK_OPERATION_LIMIT_EXCEEDED: 409,
    TRANSLATION_EXPORT_LIMIT_EXCEEDED: 409,
    TRANSLATION_VALIDATION_FAILED: 400,
    UNSUPPORTED_BULK_OPERATION: 400,
    INVALID_STATIC_PAGE_TRANSLATION: 400,
    INVALID_STATIC_PAGE_CONTENT: 400,
    STATIC_PAGE_SOURCE_NOT_FOUND: 404,
  };
  return res.status(statusByCode[error.code] || 400).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.validationErrors ? { validationErrors: error.validationErrors } : {}),
  });
};

export const getAdminStaticPages = async (_req, res) => {
  res.json({ success: true, data: listStaticPages() });
};

export const getAdminStaticPageEditor = async (req, res) => {
  try {
    const data = await getStaticPageEditor(req.params);
    if (!data) return res.status(404).json({ success: false, message: 'Static page not found' });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const publishAdminStaticPage = async (req, res) => {
  try {
    const data = await publishStaticPageTranslation({ ...req.params, content: req.body.content });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getPublishingPolicies = async (req, res) => {
  try {
    const filters = {
      ...(req.query.businessObjectType ? { businessObjectType: req.query.businessObjectType } : {}),
      ...(req.query.languageCode ? { languageCode: req.query.languageCode } : {}),
      ...(req.query.activeOnly === 'true' ? { isActive: true } : {}),
    };
    const data = await TranslationPublishingPolicy.find(filters)
      .sort({ businessObjectType: 1, languageCode: 1, version: -1 })
      .lean();
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const createPublishingPolicy = async (req, res) => {
  try {
    const data = await createPublishingPolicyVersion({
      businessObjectType: req.body.businessObjectType,
      languageCode: req.body.languageCode,
      publicationMode: req.body.publicationMode,
      requiredMasterStatus: req.body.requiredMasterStatus,
      creatorImprovementMode: req.body.creatorImprovementMode,
      adminId: req.user._id,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const activatePublishingPolicy = async (req, res) => {
  try {
    const data = await activatePublishingPolicyVersion(req.params.policyId, req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const getCreatorTrustPolicies = (req, res) =>
  res.json({
    success: true,
    data: Object.values(BUSINESS_OBJECT_TYPES).map((businessObjectType) => ({
      businessObjectType,
      ...resolveCreatorTrustPolicy(businessObjectType),
    })),
  });

export const approveTranslation = async (req, res) => {
  try {
    const data = await approveTranslationPublication({
      translationRecordId: req.params.translationRecordId,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
      comment: req.body.comment,
      recipient: req.body.recipient,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const rejectTranslationReview = async (req, res) => {
  try { res.json({ success: true, data: await rejectTranslationReviewRecord({ translationRecordId: req.params.translationRecordId, expectedVersion: req.body.expectedVersion, adminId: req.user._id, comment: req.body.comment }) }); }
  catch (error) { sendError(res, error); }
};

export const returnTranslationForModification = async (req, res) => {
  try { res.json({ success: true, data: await returnTranslationForModificationRecord({ translationRecordId: req.params.translationRecordId, expectedVersion: req.body.expectedVersion, adminId: req.user._id, comment: req.body.comment }) }); }
  catch (error) { sendError(res, error); }
};

export const getTranslationReviewQueue = async (req, res) => {
  try { res.json({ success: true, data: await listManualReviewTasks(req.query) }); }
  catch (error) { sendError(res, error); }
};

export const assignReviewTask = async (req, res) => {
  try { res.json({ success: true, data: await assignTranslationReviewTask({ taskId: req.params.taskId, assigneeId: req.body.assigneeId, actorId: req.user._id }) }); }
  catch (error) { sendError(res, error); }
};

export const claimReviewTask = async (req, res) => {
  try { res.json({ success: true, data: await claimTranslationReviewTask({ taskId: req.params.taskId, actorId: req.user._id }) }); }
  catch (error) { sendError(res, error); }
};

export const getTranslationRoles = async (_req, res) => {
  try { res.json({ success: true, data: await TranslationRole.find().populate('members', 'firstName lastName email').sort({ name: 1 }).lean() }); }
  catch (error) { sendError(res, error); }
};

export const createTranslationRole = async (req, res) => {
  try {
    const data = await TranslationRole.create({ name: req.body.name, permissions: req.body.permissions || [], members: req.body.members || [], isActive: req.body.isActive !== false, createdBy: req.user._id, updatedBy: req.user._id });
    res.status(201).json({ success: true, data });
  } catch (error) { sendError(res, error); }
};

export const updateTranslationRole = async (req, res) => {
  try {
    const data = await TranslationRole.findByIdAndUpdate(req.params.roleId, { $set: { ...(req.body.name ? { name: req.body.name } : {}), ...(req.body.permissions ? { permissions: req.body.permissions } : {}), ...(req.body.members ? { members: req.body.members } : {}), ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}), updatedBy: req.user._id } }, { returnDocument: 'after', runValidators: true });
    if (!data) return res.status(404).json({ success: false, code: 'TRANSLATION_ROLE_NOT_FOUND', message: 'Translation role not found' });
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error); }
};

export const getTranslationPermissions = async (req, res) => {
  try { res.json({ success: true, data: { permissions: await getTranslationPermissionsForUser(req.user), availablePermissions: TRANSLATION_PERMISSIONS } }); }
  catch (error) { sendError(res, error); }
};

export const getAdminTranslationNotifications = async (req, res) => {
  try { res.json({ success: true, data: await listTranslationNotifications({ recipient: req.user._id, unreadOnly: req.query.unreadOnly === 'true' }) }); }
  catch (error) { sendError(res, error); }
};

export const markAdminTranslationNotificationRead = async (req, res) => {
  try {
    const data = await markTranslationNotificationRead(req.params.notificationId, req.user._id);
    if (!data) return res.status(404).json({ success: false, code: 'TRANSLATION_NOTIFICATION_NOT_FOUND', message: 'Translation notification not found' });
    return res.json({ success: true, data });
  } catch (error) { return sendError(res, error); }
};

export const updateAdminTranslationNotificationPreferences = async (req, res) => {
  try { res.json({ success: true, data: await updateTranslationNotificationPreferences(req.user._id, req.body) }); }
  catch (error) { sendError(res, error); }
};

export const applyTranslationOverride = async (req, res) => {
  try {
    const data = await applyAdministrativeOverride({
      translationRecordId: req.params.translationRecordId,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
      publicationStatus: req.body.publicationStatus,
      reviewLevel: req.body.reviewLevel,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const verifyTranslation = async (req, res) => {
  try {
    const data = await setTranslationVerified({
      translationRecordId: req.params.translationRecordId,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const rollbackTranslation = async (req, res) => {
  try {
    const data = await restoreTranslationVersion({
      translationRecordId: req.params.translationRecordId,
      versionNumber: req.body.versionNumber,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const unpublishTranslation = async (req, res) => {
  try {
    const data = await unpublishTranslationRecord({
      translationRecordId: req.params.translationRecordId,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const archiveTranslation = async (req, res) => {
  try {
    const data = await archiveTranslationRecord({
      translationRecordId: req.params.translationRecordId,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const editTranslationContentAndSeo = async (req, res) => {
  try {
    const record = await TranslationRecord.findById(req.params.translationRecordId);
    if (!record) {
      const error = new Error('Translation record not found');
      error.code = 'TRANSLATION_NOT_FOUND';
      throw error;
    }
    await assertEditLock({
      translationRecordId: record._id,
      adminId: req.user._id,
      lockToken: req.body.lockToken,
    });
    const source = await getSourceContentForObject({
      businessObjectType: record.businessObjectType,
      businessObjectId: record.businessObjectId,
    });
    const data = await saveAdminTranslationEdit({
      translationRecordId: record._id,
      sourceContent: source.sourceContent,
      sourceVersion: source.sourceVersion,
      translatedContent: req.body.content,
      seo: req.body.seo ?? record.seo,
      expectedVersion: req.body.expectedVersion,
      adminId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const acquireTranslationEditLock = async (req, res) => {
  try {
    const record = await TranslationRecord.exists({ _id: req.params.translationRecordId });
    if (!record) {
      const error = new Error('Translation record not found');
      error.code = 'TRANSLATION_NOT_FOUND';
      throw error;
    }
    res.json({
      success: true,
      data: await acquireEditLock({
        translationRecordId: req.params.translationRecordId,
        adminId: req.user._id,
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
};

export const refreshTranslationEditLock = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await refreshEditLock({
        translationRecordId: req.params.translationRecordId,
        adminId: req.user._id,
        lockToken: req.body.lockToken,
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
};

export const releaseTranslationEditLock = async (req, res) => {
  try {
    res.json({
      success: true,
      data: await releaseEditLock({
        translationRecordId: req.params.translationRecordId,
        adminId: req.user._id,
        lockToken: req.body.lockToken,
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
};

export const requestAdminTranslationRegeneration = async (req, res) => {
  try {
    const record = await TranslationRecord.findById(req.params.translationRecordId).lean();
    if (!record) {
      const error = new Error('Translation record not found');
      error.code = 'TRANSLATION_NOT_FOUND';
      throw error;
    }
    const source = await getSourceContentForObject({
      businessObjectType: record.businessObjectType,
      businessObjectId: record.businessObjectId,
    });
    const regenerationRequestId = crypto.randomUUID();
    const job = await regenerateTranslation({
      businessObjectType: record.businessObjectType,
      businessObjectId: record.businessObjectId,
      targetLanguageCode: record.languageCode,
      sourceVersion: source.sourceVersion,
      sourceContent: source.sourceContent,
      idempotencyDiscriminator: regenerationRequestId,
      context: {
        requestedBy: req.user._id,
        requestedByRole: 'admin',
        regenerationRequestId,
        ...(source.cmsKey ? { cmsKey: source.cmsKey } : {}),
      },
    });
    res.status(202).json({ success: true, data: job });
  } catch (error) {
    sendError(res, error);
  }
};

export const acceptAdminTranslationProposal = async (req, res) => {
  try {
    const data = await acceptTranslationProposal({
      proposalId: req.params.proposalId,
      actorId: req.user._id,
      actorRole: 'admin',
      action: req.body.action,
      mergedContent: req.body.mergedContent,
      expectedVersion: req.body.expectedVersion,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const discardAdminTranslationProposal = async (req, res) => {
  try {
    const data = await discardTranslationProposal({
      proposalId: req.params.proposalId,
      actorId: req.user._id,
      actorRole: 'admin',
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const enqueueBulkTranslationOperation = async (req, res) => {
  try {
    const operation = req.body.operation || 'regenerate';
    if (!['translate', 'regenerate'].includes(operation)) {
      const error = new Error('Bulk operation must be translate or regenerate');
      error.code = 'UNSUPPORTED_BULK_OPERATION';
      throw error;
    }
    const records = await getTranslationRecordsForBulk(req.body.filters || req.query);
    if (records.length > 5_000) {
      const error = new Error('Bulk translation operations are limited to 5,000 records');
      error.code = 'BULK_OPERATION_LIMIT_EXCEEDED';
      throw error;
    }
    const bulkOperationId = crypto.randomUUID();
    const requests = await Promise.all(
      records
        .filter((record) => record.languageCode !== 'en')
        .map(async (record) => {
          const source = await getSourceContentForObject({
            businessObjectType: record.businessObjectType,
            businessObjectId: record.businessObjectId,
          });
          return {
            businessObjectType: record.businessObjectType,
            businessObjectId: record.businessObjectId,
            targetLanguageCode: record.languageCode,
            sourceVersion: source.sourceVersion,
            sourceContent: source.sourceContent,
            idempotencyDiscriminator: `${bulkOperationId}:${record._id}`,
            context: {
              bulkOperationId,
              requestedBy: req.user._id,
              requestedByRole: 'admin',
              ...(source.cmsKey ? { cmsKey: source.cmsKey } : {}),
            },
          };
        })
    );
    const jobs = operation === 'translate'
      ? await requestBulkTranslations(requests)
      : await Promise.all(requests.map((request) => regenerateTranslation(request)));
    res.status(202).json({
      success: true,
      data: { bulkOperationId, operation, jobCount: jobs.length, jobs },
    });
  } catch (error) {
    sendError(res, error);
  }
};

export const getBulkTranslationOperationSummary = async (req, res) => {
  try {
    res.json({ success: true, data: await getBulkOperationSummary(req.params.bulkOperationId) });
  } catch (error) {
    sendError(res, error);
  }
};

export const getBulkTranslationOperationJobs = async (req, res) => {
  try {
    res.json({ success: true, data: await listBulkOperationJobs(req.params.bulkOperationId, req.query) });
  } catch (error) {
    sendError(res, error);
  }
};

export const retryTranslationJob = async (req, res) => {
  try {
    const data = await retryDeadLetterTranslationJob(req.params.jobId);
    if (!data) return res.status(404).json({ success: false, code: 'TRANSLATION_JOB_NOT_FOUND', message: 'Retryable translation job not found' });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const cancelQueuedTranslationJob = async (req, res) => {
  try {
    const data = await cancelTranslationJob(req.params.jobId);
    if (!data) return res.status(404).json({ success: false, code: 'TRANSLATION_JOB_NOT_FOUND', message: 'Cancellable translation job not found' });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const exportTranslationOperationsExcel = async (req, res) => {
  try {
    const { records, jobs, usage } = await getTranslationOperationalExportData(req.query);
    const workbook = new ExcelJS.Workbook();
    const recordSheet = workbook.addWorksheet('Translations');
    recordSheet.columns = [
      { header: 'Record ID', key: 'recordId', width: 28 },
      { header: 'Object Type', key: 'objectType', width: 18 },
      { header: 'Object ID', key: 'objectId', width: 28 },
      { header: 'Language', key: 'languageCode', width: 12 },
      { header: 'Translation Status', key: 'translationStatus', width: 20 },
      { header: 'Publication Status', key: 'publicationStatus', width: 20 },
      { header: 'Review Level', key: 'reviewLevel', width: 18 },
      { header: 'Version', key: 'versionNumber', width: 10 },
      { header: 'Provider', key: 'provider', width: 18 },
      { header: 'Model', key: 'model', width: 24 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Memory Hit', key: 'memoryHit', width: 12 },
      { header: 'Updated At', key: 'updatedAt', width: 24 },
    ];
    records.forEach((record) => recordSheet.addRow({
      recordId: String(record._id),
      objectType: record.businessObjectType,
      objectId: String(record.businessObjectId),
      languageCode: record.languageCode,
      translationStatus: record.translationStatus,
      publicationStatus: record.publicationStatus,
      reviewLevel: record.reviewLevel,
      versionNumber: record.versionNumber,
      provider: record.metadata?.provider,
      model: record.metadata?.model,
      confidence: record.metadata?.confidence,
      memoryHit: record.metadata?.memoryHit,
      updatedAt: record.updatedAt,
    }));

    const jobSheet = workbook.addWorksheet('Jobs');
    jobSheet.columns = [
      { header: 'Job ID', key: 'jobId', width: 34 },
      { header: 'Operation', key: 'operation', width: 14 },
      { header: 'Object Type', key: 'objectType', width: 18 },
      { header: 'Object ID', key: 'objectId', width: 28 },
      { header: 'Language', key: 'languageCode', width: 12 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Attempts', key: 'attemptCount', width: 12 },
      { header: 'Failure Code', key: 'failureCode', width: 24 },
      { header: 'Failure Message', key: 'failureMessage', width: 50 },
      { header: 'Created At', key: 'createdAt', width: 24 },
      { header: 'Completed At', key: 'completedAt', width: 24 },
    ];
    jobs.forEach((job) => jobSheet.addRow({
      jobId: job.jobId,
      operation: job.operation,
      objectType: job.businessObjectType,
      objectId: String(job.businessObjectId),
      languageCode: job.targetLanguageCode,
      status: job.status,
      attemptCount: job.attemptCount,
      failureCode: job.failure?.code,
      failureMessage: job.failure?.message,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    }));

    const usageSheet = workbook.addWorksheet('AI Usage');
    usageSheet.columns = [
      { header: 'Job ID', key: 'jobId', width: 34 },
      { header: 'Provider', key: 'provider', width: 18 },
      { header: 'Model', key: 'model', width: 24 },
      { header: 'Outcome', key: 'outcome', width: 12 },
      { header: 'Latency Ms', key: 'latencyMs', width: 14 },
      { header: 'Input Tokens', key: 'inputTokens', width: 14 },
      { header: 'Output Tokens', key: 'outputTokens', width: 15 },
      { header: 'Total Tokens', key: 'totalTokens', width: 14 },
      { header: 'Memory Hit', key: 'memoryHit', width: 12 },
      { header: 'Created At', key: 'createdAt', width: 24 },
    ];
    usage.forEach((event) => usageSheet.addRow({
      jobId: event.jobId,
      provider: event.provider,
      model: event.model,
      outcome: event.outcome,
      latencyMs: event.latencyMs,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      totalTokens: event.totalTokens,
      memoryHit: event.memoryHit,
      createdAt: event.createdAt,
    }));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="WCM_Translation_Operations_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    sendError(res, error);
  }
};

export const getTranslationDashboard = async (_req, res) => {
  try { res.json({ success: true, data: await getDashboard() }); } catch (error) { sendError(res, error); }
};

export const searchTranslationRecords = async (req, res) => {
  try { res.json({ success: true, data: await searchRecords(req.query) }); } catch (error) { sendError(res, error); }
};

export const getTranslationRecordDetails = async (req, res) => {
  try { res.json({ success: true, data: await getDetails(req.params.translationRecordId) }); } catch (error) { sendError(res, error); }
};

export const getTranslationOperationsHealth = async (_req, res) => { try { res.json({ success: true, data: await getTranslationOperationalHealth() }); } catch (error) { sendError(res, error); } };
export const getTranslationOperationsLogs = async (req, res) => { try { res.json({ success: true, data: await listTranslationOperationalLogs(req.query) }); } catch (error) { sendError(res, error); } };
export const getTranslationAlerts = async (_req, res) => { try { await evaluateOperationalAlerts(); res.json({ success: true, data: await listOperationalAlerts() }); } catch (error) { sendError(res, error); } };
export const patchTranslationAlert = async (req, res) => { try { const data = await updateOperationalAlert(req.params.alertId, req.body.status, req.user._id); if (!data) return res.status(404).json({ success: false, message: 'Operational alert not found' }); return res.json({ success: true, data }); } catch (error) { return sendError(res, error); } };
export const getTranslationConfiguration = async (_req, res) => { try { res.json({ success: true, data: await getActiveTranslationConfiguration() }); } catch (error) { sendError(res, error); } };
export const getTranslationConfigurationVersions = async (_req, res) => { try { res.json({ success: true, data: await TranslationOperationalConfig.find().sort({ version: -1 }).lean() }); } catch (error) { sendError(res, error); } };
export const createTranslationConfiguration = async (req, res) => { try { res.status(201).json({ success: true, data: await createConfigurationVersion({ configuration: req.body, actorId: req.user._id }) }); } catch (error) { sendError(res, error); } };
export const activateTranslationConfiguration = async (req, res) => { try { res.json({ success: true, data: await activateConfigurationVersion(req.params.configurationId, req.user._id) }); } catch (error) { sendError(res, error); } };
export const getTranslationPrompts = async (_req, res) => { try { res.json({ success: true, data: await TranslationPrompt.find().sort({ key: 1, version: -1 }).lean() }); } catch (error) { sendError(res, error); } };
export const createTranslationPrompt = async (req, res) => { try { res.status(201).json({ success: true, data: await createPromptVersion({ ...req.body, actorId: req.user._id }) }); } catch (error) { sendError(res, error); } };
export const patchTranslationPrompt = async (req, res) => { try { const data = await TranslationPrompt.findByIdAndUpdate(req.params.promptId, { $set: { systemTemplate: req.body.systemTemplate, userTemplate: req.body.userTemplate, requiredVariables: req.body.requiredVariables } }, { returnDocument: 'after', runValidators: true }); if (!data) return res.status(404).json({ success: false, message: 'Translation prompt not found' }); return res.json({ success: true, data }); } catch (error) { return sendError(res, error); } };
export const activateTranslationPrompt = async (req, res) => { try { res.json({ success: true, data: await activatePromptVersion(req.params.promptId, req.user._id) }); } catch (error) { sendError(res, error); } };
const terminologyController = (Model, normalized) => ({ list: async (_req, res) => { try { res.json({ success: true, data: await Model.find().sort({ updatedAt: -1 }).lean() }); } catch (e) { sendError(res, e); } }, create: async (req, res) => { try { res.status(201).json({ success: true, data: await Model.create({ ...req.body, ...normalized(req.body), createdBy: req.user._id, updatedBy: req.user._id }) }); } catch (e) { sendError(res, e); } }, patch: async (req, res) => { try { const data = await Model.findByIdAndUpdate(req.params.id, { $set: { ...req.body, ...normalized(req.body), updatedBy: req.user._id } }, { returnDocument: 'after', runValidators: true }); if (!data) return res.status(404).json({ success: false, message: 'Terminology entry not found' }); return res.json({ success: true, data }); } catch (e) { return sendError(res, e); } } });
const dictionary = terminologyController(TranslationDictionaryEntry, normalizeTerminologyFields);
const protectedTerm = terminologyController(ProtectedTerm, normalizeTerminologyFields);
export const listTranslationDictionary = dictionary.list; export const createTranslationDictionary = dictionary.create; export const patchTranslationDictionary = dictionary.patch;
export const listProtectedTerms = protectedTerm.list; export const createProtectedTerm = protectedTerm.create; export const patchProtectedTerm = protectedTerm.patch;
export const getTranslationMemory = async (req, res) => { try { res.json({ success: true, data: await listMemoryEntries({ ...(req.query.isArchived !== undefined ? { isArchived: req.query.isArchived === 'true' } : {}) }) }); } catch (error) { sendError(res, error); } };
export const patchTranslationMemory = async (req, res) => { try { const data = await updateMemoryEntry(req.params.memoryId, req.body, req.user._id); if (!data) return res.status(404).json({ success: false, message: 'Translation memory entry not found' }); return res.json({ success: true, data }); } catch (error) { return sendError(res, error); } };
export const archiveTranslationMemory = async (req, res) => { try { const data = await archiveMemoryEntry(req.params.memoryId, req.user._id); if (!data) return res.status(404).json({ success: false, message: 'Translation memory entry not found' }); return res.json({ success: true, data }); } catch (error) { return sendError(res, error); } };
