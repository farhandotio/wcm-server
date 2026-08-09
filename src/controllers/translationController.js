import {
  acceptCreatorRegeneration,
  discardCreatorRegeneration,
  getCreatorTranslationWorkspace as getWorkspace,
  listCreatorTranslationAvailability,
  listCreatorTranslationVersions,
  requestCreatorRegeneration,
  saveCreatorImprovement,
} from '../services/translation/creatorTranslationService.js';
import {
  listTranslationNotifications,
  markTranslationNotificationRead,
  updateTranslationNotificationPreferences,
} from '../services/translation/translationNotificationService.js';

const sendError = (res, error) => {
  const statusByCode = {
    TRANSLATION_OWNERSHIP_DENIED: 403,
    ACCOUNT_RESTRICTED: 403,
    TRANSLATION_PROPOSAL_NOT_FOUND: 404,
    TRANSLATION_NOT_FOUND: 404,
    TRANSLATION_REGENERATION_LIMIT_REACHED: 429,
    STALE_TRANSLATION_JOB: 409,
    TRANSLATION_VALIDATION_FAILED: 400,
  };
  const status = statusByCode[error.code] || 400;

  return res.status(status).json({
    success: false,
    code: error.code,
    message: error.message,
  });
};

export const getCreatorTranslationWorkspace = async (req, res) => {
  try {
    const data = await getWorkspace({
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      creatorId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const getCreatorTranslationAvailability = async (req, res) => {
  try {
    const data = await listCreatorTranslationAvailability({
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      creatorId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const saveCreatorTranslationImprovement = async (req, res) => {
  try {
    const data = await saveCreatorImprovement({
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      creatorId: req.user._id,
      creatorStatus: req.user.status,
      targetLanguageCode: req.body.targetLanguageCode,
      sourceVersion: req.body.sourceVersion,
      translatedContent: req.body.translatedContent,
      expectedVersion: req.body.expectedVersion,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const requestCreatorTranslationRegeneration = async (req, res) => {
  try {
    const data = await requestCreatorRegeneration({
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      creatorId: req.user._id,
      creatorStatus: req.user.status,
      targetLanguageCode: req.body.targetLanguageCode,
      sourceVersion: req.body.sourceVersion,
    });
    res.status(202).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const acceptCreatorTranslationProposal = async (req, res) => {
  try {
    const data = await acceptCreatorRegeneration({
      proposalId: req.params.proposalId,
      creatorId: req.user._id,
      creatorStatus: req.user.status,
      action: req.body.action,
      mergedContent: req.body.mergedContent,
      expectedVersion: req.body.expectedVersion,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const discardCreatorTranslationProposal = async (req, res) => {
  try {
    const data = await discardCreatorRegeneration({
      proposalId: req.params.proposalId,
      creatorId: req.user._id,
      creatorStatus: req.user.status,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const getCreatorTranslationVersions = async (req, res) => {
  try {
    const data = await listCreatorTranslationVersions({
      translationRecordId: req.params.translationRecordId,
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      creatorId: req.user._id,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const getCreatorTranslationNotifications = async (req, res) => {
  try {
    const data = await listTranslationNotifications({
      recipient: req.user._id,
      unreadOnly: req.query.unreadOnly === 'true',
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

export const markCreatorTranslationNotificationRead = async (req, res) => {
  try {
    const data = await markTranslationNotificationRead(req.params.notificationId, req.user._id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Translation notification not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateCreatorTranslationNotificationPreferences = async (req, res) => {
  try {
    const data = await updateTranslationNotificationPreferences(req.user._id, {
      enabled: req.body.enabled,
      enabledEvents: req.body.enabledEvents,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};
