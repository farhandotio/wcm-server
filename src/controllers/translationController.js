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
import {
  buildLocalizedMetadata,
  changeLocalizedSlug,
  resolveLocalizedSlug,
  resolveSlugRedirect,
} from '../services/translation/localizedUrlService.js';
import {
  assertCreatorOwnsBusinessObject,
  assertCreatorTranslationMutationAllowed,
} from '../services/translation/creatorTranslationService.js';
import TranslationRecord from '../models/TranslationRecord.js';
import { getPublicTranslationSitemap } from '../services/translation/translationSitemapService.js';

const sendError = (res, error) => {
  const statusByCode = {
    TRANSLATION_OWNERSHIP_DENIED: 403,
    ACCOUNT_RESTRICTED: 403,
    TRANSLATION_PROPOSAL_NOT_FOUND: 404,
    TRANSLATION_NOT_FOUND: 404,
    TRANSLATION_REGENERATION_LIMIT_REACHED: 429,
    STALE_TRANSLATION_JOB: 409,
    TRANSLATION_VALIDATION_FAILED: 400,
    UNSUPPORTED_BUSINESS_OBJECT: 400,
    UNSUPPORTED_LANGUAGE: 400,
    LOCALIZED_SLUG_UNSUPPORTED: 400,
    INVALID_LOCALIZED_SLUG: 400,
    LOCALIZED_SLUG_CONFLICT: 409,
    LOCALIZED_SLUG_PERMANENTLY_RESERVED: 409,
    TRANSLATION_VERSION_CONFLICT: 409,
    TRANSLATION_NOT_PUBLISHED: 409,
    SOURCE_SLUG_MANAGED_BY_OBJECT: 409,
  };
  const status = statusByCode[error.code] || 400;

  return res.status(status).json({
    success: false,
    code: error.code,
    message: error.message,
  });
};

export const getTranslationSitemap = async (_req, res) => {
  try {
    return res.json({ success: true, data: await getPublicTranslationSitemap() });
  } catch (error) {
    return sendError(res, error);
  }
};

export const resolveLocalizedUrl = async (req, res) => {
  try {
    const request = {
      businessObjectType: req.params.businessObjectType,
      languageCode: req.params.languageCode,
      slug: req.params.slug,
    };
    const redirect = await resolveSlugRedirect(request);
    if (redirect) {
      return res.json({ success: true, data: { type: 'redirect', ...redirect } });
    }

    const resolved = await resolveLocalizedSlug(request);
    if (!resolved) {
      return res.status(404).json({ success: false, message: 'Localized URL not found' });
    }
    const metadata = await buildLocalizedMetadata({
      businessObjectType: resolved.businessObjectType,
      businessObjectId: resolved.businessObjectId,
      languageCode: resolved.languageCode,
      baseUrl: process.env.CLIENT_URL || process.env.FRONTEND_URL,
    });

    return res.json({
      success: true,
      data: {
        type: 'business_object',
        businessObjectType: resolved.businessObjectType,
        businessObjectId: resolved.businessObjectId,
        languageCode: resolved.languageCode,
        slug: resolved.slug,
        fallback: resolved.fallback,
        translation: resolved.translation,
        metadata,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const changeCreatorLocalizedSlug = async (req, res) => {
  try {
    assertCreatorTranslationMutationAllowed(req.user.status);
    await assertCreatorOwnsBusinessObject({
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      creatorId: req.user._id,
    });
    const record = await TranslationRecord.findOne({
      businessObjectType: req.params.businessObjectType,
      businessObjectId: req.params.businessObjectId,
      languageCode: req.body.languageCode,
    }).select('_id');
    if (!record) {
      const error = new Error('Translation record not found');
      error.code = 'TRANSLATION_NOT_FOUND';
      throw error;
    }

    const data = await changeLocalizedSlug({
      translationRecordId: record._id,
      slug: req.body.slug,
      expectedVersion: req.body.expectedVersion,
      actor: req.user._id,
      actorRole: 'creator',
      statusCode: req.body.statusCode,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const changeAdminLocalizedSlug = async (req, res) => {
  try {
    const data = await changeLocalizedSlug({
      translationRecordId: req.params.translationRecordId,
      slug: req.body.slug,
      expectedVersion: req.body.expectedVersion,
      actor: req.user._id,
      actorRole: 'admin',
      statusCode: req.body.statusCode,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
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
