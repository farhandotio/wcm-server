import express from 'express';
import {
  acceptCreatorTranslationProposal,
  changeAdminLocalizedSlug,
  changeCreatorLocalizedSlug,
  discardCreatorTranslationProposal,
  getCreatorTranslationAvailability,
  getCreatorTranslationNotifications,
  getCreatorTranslationVersions,
  getCreatorTranslationWorkspace,
  markCreatorTranslationNotificationRead,
  requestCreatorTranslationRegeneration,
  resolveLocalizedUrl,
  getTranslationSitemap,
  getPublicStaticPageTranslation,
  saveCreatorTranslationImprovement,
  updateCreatorTranslationNotificationPreferences,
} from '../controllers/translationController.js';
import {
  activatePublishingPolicy,
  applyTranslationOverride,
  acquireTranslationEditLock,
  acceptAdminTranslationProposal,
  approveTranslation,
  archiveTranslation,
  cancelQueuedTranslationJob,
  createPublishingPolicy,
  discardAdminTranslationProposal,
  editTranslationContentAndSeo,
  enqueueBulkTranslationOperation,
  exportTranslationOperationsExcel,
  getBulkTranslationOperationJobs,
  getBulkTranslationOperationSummary,
  getCreatorTrustPolicies,
  getPublishingPolicies,
  rollbackTranslation,
  refreshTranslationEditLock,
  releaseTranslationEditLock,
  requestAdminTranslationRegeneration,
  retryTranslationJob,
  unpublishTranslation,
  verifyTranslation,
  getTranslationDashboard,
  searchTranslationRecords,
  getTranslationRecordDetails,
  rejectTranslationReview,
  returnTranslationForModification,
  getTranslationReviewQueue,
  assignReviewTask,
  claimReviewTask,
  getTranslationRoles,
  createTranslationRole,
  updateTranslationRole,
  getTranslationPermissions,
  getAdminTranslationNotifications,
  markAdminTranslationNotificationRead,
  updateAdminTranslationNotificationPreferences,
  getTranslationOperationsHealth, getTranslationOperationsLogs, getTranslationAlerts, patchTranslationAlert,
  getTranslationConfiguration, getTranslationConfigurationVersions, createTranslationConfiguration, activateTranslationConfiguration,
  getTranslationPrompts, createTranslationPrompt, patchTranslationPrompt, activateTranslationPrompt,
  listTranslationDictionary, createTranslationDictionary, patchTranslationDictionary, listProtectedTerms, createProtectedTerm, patchProtectedTerm,
  getTranslationMemory, patchTranslationMemory, archiveTranslationMemory,
  getAdminStaticPages, getAdminStaticPageEditor, publishAdminStaticPage,
} from '../controllers/translationAdminController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';
import { requireTranslationPermission } from '../middlewares/translationPermissions.js';
import { createLanguage, disableLanguageConfiguration, enableLanguageConfiguration, getLanguageBackfill, getLanguages, getPublishedLanguages, publishLanguageConfiguration, retryLanguageConfiguration, unpublishLanguageConfiguration } from '../controllers/languageConfigurationController.js';

const router = express.Router();

router.get('/languages', getPublishedLanguages);
router.get('/sitemap', getTranslationSitemap);
router.get('/static-pages/:pageKey/:languageCode', getPublicStaticPageTranslation);
router.get('/url/:languageCode/:businessObjectType/:slug', resolveLocalizedUrl);

router.use(authMiddleware);

router.use('/creator', authorizeRoles('creator'));
router.get('/creator/notifications', getCreatorTranslationNotifications);
router.patch('/creator/notifications/:notificationId/read', markCreatorTranslationNotificationRead);
router.put('/creator/notification-preferences', updateCreatorTranslationNotificationPreferences);
router.get(
  '/creator/:businessObjectType/:businessObjectId/workspace',
  getCreatorTranslationWorkspace
);
router.get(
  '/creator/:businessObjectType/:businessObjectId/availability',
  getCreatorTranslationAvailability
);
router.put(
  '/creator/:businessObjectType/:businessObjectId/improvement',
  saveCreatorTranslationImprovement
);
router.patch(
  '/creator/:businessObjectType/:businessObjectId/slug',
  changeCreatorLocalizedSlug
);
router.post(
  '/creator/:businessObjectType/:businessObjectId/regenerations',
  requestCreatorTranslationRegeneration
);
router.post('/creator/proposals/:proposalId/accept', acceptCreatorTranslationProposal);
router.post('/creator/proposals/:proposalId/discard', discardCreatorTranslationProposal);
router.get(
  '/creator/:businessObjectType/:businessObjectId/records/:translationRecordId/versions',
  getCreatorTranslationVersions
);

router.get('/admin/permissions', getTranslationPermissions);
router.get('/admin/languages', requireTranslationPermission('translation.configuration.manage'), getLanguages);
router.post('/admin/languages', requireTranslationPermission('translation.configuration.manage'), createLanguage);
router.post('/admin/languages/:code/enable', requireTranslationPermission('translation.configuration.manage'), enableLanguageConfiguration);
router.get('/admin/languages/:code/backfill', requireTranslationPermission('translation.configuration.manage'), getLanguageBackfill);
router.post('/admin/languages/:code/retry', requireTranslationPermission('translation.configuration.manage'), retryLanguageConfiguration);
router.post('/admin/languages/:code/publish', requireTranslationPermission('translation.configuration.manage'), publishLanguageConfiguration);
router.post('/admin/languages/:code/unpublish', requireTranslationPermission('translation.configuration.manage'), unpublishLanguageConfiguration);
router.post('/admin/languages/:code/disable', requireTranslationPermission('translation.configuration.manage'), disableLanguageConfiguration);
router.get('/admin/dashboard', requireTranslationPermission('translation.centre.read'), getTranslationDashboard);
router.get('/admin/operations/health', requireTranslationPermission('translation.operations.read'), getTranslationOperationsHealth);
router.get('/admin/operations/logs', requireTranslationPermission('translation.operations.read'), getTranslationOperationsLogs);
router.get('/admin/operations/alerts', requireTranslationPermission('translation.operations.read'), getTranslationAlerts);
router.patch('/admin/operations/alerts/:alertId', requireTranslationPermission('translation.alerts.manage'), patchTranslationAlert);
router.get('/admin/configuration', requireTranslationPermission('translation.configuration.manage'), getTranslationConfiguration);
router.get('/admin/configuration/versions', requireTranslationPermission('translation.configuration.manage'), getTranslationConfigurationVersions);
router.post('/admin/configuration/versions', requireTranslationPermission('translation.configuration.manage'), createTranslationConfiguration);
router.post('/admin/configuration/:configurationId/activate', requireTranslationPermission('translation.configuration.manage'), activateTranslationConfiguration);
router.get('/admin/prompts', requireTranslationPermission('translation.configuration.manage'), getTranslationPrompts);
router.post('/admin/prompts', requireTranslationPermission('translation.configuration.manage'), createTranslationPrompt);
router.patch('/admin/prompts/:promptId', requireTranslationPermission('translation.configuration.manage'), patchTranslationPrompt);
router.post('/admin/prompts/:promptId/activate', requireTranslationPermission('translation.configuration.manage'), activateTranslationPrompt);
router.get('/admin/dictionary', requireTranslationPermission('translation.terminology.manage'), listTranslationDictionary);
router.post('/admin/dictionary', requireTranslationPermission('translation.terminology.manage'), createTranslationDictionary);
router.patch('/admin/dictionary/:id', requireTranslationPermission('translation.terminology.manage'), patchTranslationDictionary);
router.get('/admin/protected-terms', requireTranslationPermission('translation.terminology.manage'), listProtectedTerms);
router.post('/admin/protected-terms', requireTranslationPermission('translation.terminology.manage'), createProtectedTerm);
router.patch('/admin/protected-terms/:id', requireTranslationPermission('translation.terminology.manage'), patchProtectedTerm);
router.get('/admin/memory', requireTranslationPermission('translation.memory.manage'), getTranslationMemory);
router.patch('/admin/memory/:memoryId', requireTranslationPermission('translation.memory.manage'), patchTranslationMemory);
router.patch('/admin/memory/:memoryId/archive', requireTranslationPermission('translation.memory.manage'), archiveTranslationMemory);
router.get('/admin/records', requireTranslationPermission('translation.centre.read'), searchTranslationRecords);
router.get('/admin/records/:translationRecordId', requireTranslationPermission('translation.centre.read'), getTranslationRecordDetails);
router.get('/admin/review-queue', requireTranslationPermission('translation.centre.read'), getTranslationReviewQueue);
router.get('/admin/static-pages', requireTranslationPermission('translation.centre.read'), getAdminStaticPages);
router.get('/admin/static-pages/:pageKey/:languageCode', requireTranslationPermission('translation.centre.read'), getAdminStaticPageEditor);
router.put('/admin/static-pages/:pageKey/:languageCode/publish', requireTranslationPermission('translation.review.decide'), publishAdminStaticPage);
router.post('/admin/review-tasks/:taskId/assign', requireTranslationPermission('translation.review.assign'), assignReviewTask);
router.post('/admin/review-tasks/:taskId/claim', requireTranslationPermission('translation.review.assign'), claimReviewTask);
router.get('/admin/notifications', requireTranslationPermission('translation.centre.read'), getAdminTranslationNotifications);
router.patch('/admin/notifications/:notificationId/read', requireTranslationPermission('translation.centre.read'), markAdminTranslationNotificationRead);
router.put('/admin/notification-preferences', requireTranslationPermission('translation.centre.read'), updateAdminTranslationNotificationPreferences);
router.get('/admin/roles', requireTranslationPermission('translation.roles.manage'), getTranslationRoles);
router.post('/admin/roles', requireTranslationPermission('translation.roles.manage'), createTranslationRole);
router.patch('/admin/roles/:roleId', requireTranslationPermission('translation.roles.manage'), updateTranslationRole);
router.get('/admin/export.xlsx', requireTranslationPermission('translation.centre.read'), exportTranslationOperationsExcel);
router.post('/admin/bulk/enqueue', requireTranslationPermission('translation.review.regenerate'), enqueueBulkTranslationOperation);
router.get('/admin/bulk/:bulkOperationId/summary', requireTranslationPermission('translation.centre.read'), getBulkTranslationOperationSummary);
router.get('/admin/bulk/:bulkOperationId/jobs', requireTranslationPermission('translation.centre.read'), getBulkTranslationOperationJobs);
router.post('/admin/jobs/:jobId/retry-dead-letter', requireTranslationPermission('translation.review.regenerate'), retryTranslationJob);
router.post('/admin/jobs/:jobId/cancel', requireTranslationPermission('translation.review.regenerate'), cancelQueuedTranslationJob);
router.get('/admin/publishing-policies', requireTranslationPermission('translation.centre.read'), getPublishingPolicies);
router.post('/admin/publishing-policies', requireTranslationPermission('translation.policy.manage'), createPublishingPolicy);
router.post('/admin/publishing-policies/:policyId/activate', requireTranslationPermission('translation.policy.manage'), activatePublishingPolicy);
router.get('/admin/creator-trust-policies', requireTranslationPermission('translation.centre.read'), getCreatorTrustPolicies);
router.post('/admin/records/:translationRecordId/approve', requireTranslationPermission('translation.review.decide'), approveTranslation);
router.post('/admin/records/:translationRecordId/reject', requireTranslationPermission('translation.review.decide'), rejectTranslationReview);
router.post('/admin/records/:translationRecordId/return-for-modification', requireTranslationPermission('translation.review.decide'), returnTranslationForModification);
router.patch('/admin/records/:translationRecordId/content-seo', requireTranslationPermission('translation.review.edit'), editTranslationContentAndSeo);
router.post('/admin/records/:translationRecordId/lock', requireTranslationPermission('translation.review.edit'), acquireTranslationEditLock);
router.patch('/admin/records/:translationRecordId/lock', requireTranslationPermission('translation.review.edit'), refreshTranslationEditLock);
router.delete('/admin/records/:translationRecordId/lock', requireTranslationPermission('translation.review.edit'), releaseTranslationEditLock);
router.post('/admin/records/:translationRecordId/regenerations', requireTranslationPermission('translation.review.regenerate'), requestAdminTranslationRegeneration);
router.patch('/admin/records/:translationRecordId/override', requireTranslationPermission('translation.review.decide'), applyTranslationOverride);
router.patch('/admin/records/:translationRecordId/verify', requireTranslationPermission('translation.review.decide'), verifyTranslation);
router.post('/admin/records/:translationRecordId/rollback', requireTranslationPermission('translation.review.edit'), rollbackTranslation);
router.patch('/admin/records/:translationRecordId/unpublish', requireTranslationPermission('translation.review.decide'), unpublishTranslation);
router.patch('/admin/records/:translationRecordId/archive', requireTranslationPermission('translation.review.decide'), archiveTranslation);
router.patch('/admin/records/:translationRecordId/slug', requireTranslationPermission('translation.review.edit'), changeAdminLocalizedSlug);
router.post('/admin/proposals/:proposalId/accept', requireTranslationPermission('translation.review.edit'), acceptAdminTranslationProposal);
router.post('/admin/proposals/:proposalId/discard', requireTranslationPermission('translation.review.regenerate'), discardAdminTranslationProposal);

export default router;
