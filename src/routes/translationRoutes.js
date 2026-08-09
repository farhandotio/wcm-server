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
  saveCreatorTranslationImprovement,
  updateCreatorTranslationNotificationPreferences,
} from '../controllers/translationController.js';
import {
  activatePublishingPolicy,
  applyTranslationOverride,
  approveTranslation,
  archiveTranslation,
  createPublishingPolicy,
  getCreatorTrustPolicies,
  getPublishingPolicies,
  rollbackTranslation,
  unpublishTranslation,
  verifyTranslation,
} from '../controllers/translationAdminController.js';
import { authMiddleware, authorizeRoles } from '../middlewares/auth.js';

const router = express.Router();

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

router.use('/admin', authorizeRoles('admin'));
router.get('/admin/publishing-policies', getPublishingPolicies);
router.post('/admin/publishing-policies', createPublishingPolicy);
router.post('/admin/publishing-policies/:policyId/activate', activatePublishingPolicy);
router.get('/admin/creator-trust-policies', getCreatorTrustPolicies);
router.post('/admin/records/:translationRecordId/approve', approveTranslation);
router.patch('/admin/records/:translationRecordId/override', applyTranslationOverride);
router.patch('/admin/records/:translationRecordId/verify', verifyTranslation);
router.post('/admin/records/:translationRecordId/rollback', rollbackTranslation);
router.patch('/admin/records/:translationRecordId/unpublish', unpublishTranslation);
router.patch('/admin/records/:translationRecordId/archive', archiveTranslation);
router.patch('/admin/records/:translationRecordId/slug', changeAdminLocalizedSlug);

export default router;
