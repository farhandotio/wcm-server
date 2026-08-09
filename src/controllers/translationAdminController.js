import TranslationPublishingPolicy from '../models/TranslationPublishingPolicy.js';
import { BUSINESS_OBJECT_TYPES } from '../config/businessObjectRegistry.js';
import {
  activatePublishingPolicyVersion,
  applyAdministrativeOverride,
  approveTranslationPublication,
  archiveTranslation as archiveTranslationRecord,
  createPublishingPolicyVersion,
  resolveCreatorTrustPolicy,
  unpublishTranslation as unpublishTranslationRecord,
} from '../services/translation/publishingWorkflowService.js';
import {
  restoreTranslationVersion,
  setTranslationVerified,
} from '../services/translation/translationReviewService.js';

const sendError = (res, error) =>
  res.status(error.code === 'TRANSLATION_NOT_FOUND' ? 404 : 400).json({
    success: false,
    code: error.code,
    message: error.message,
  });

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
