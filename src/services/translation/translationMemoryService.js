import TranslationMemory from '../../models/TranslationMemory.js';
import {
  canonicalizeTranslationValue,
  createLanguagePairHash,
} from './translationNormalization.js';

const APPROVED_LEVELS = Object.freeze(['admin_reviewed', 'verified']);

export const findApprovedExactMatch = async ({
  sourceLanguageCode,
  targetLanguageCode,
  fieldName,
  sourceValue,
}) => {
  const sourceHash = createLanguagePairHash({
    sourceLanguageCode,
    targetLanguageCode,
    fieldName,
    sourceValue,
  });

  return TranslationMemory.findOne({
    sourceLanguageCode,
    targetLanguageCode,
    fieldName,
    sourceHash,
    approvalLevel: { $in: APPROVED_LEVELS },
    isArchived: false,
  }).lean();
};

export const createMemoryEntryFromApprovedVersion = async ({
  sourceLanguageCode,
  targetLanguageCode,
  fieldName,
  sourceValue,
  targetValue,
  approvalLevel,
  translationRecordId = null,
  translationVersionId = null,
  actorId,
}) => {
  if (!APPROVED_LEVELS.includes(approvalLevel)) {
    throw new Error('Only admin-reviewed or verified translations can enter translation memory');
  }

  const sourceHash = createLanguagePairHash({
    sourceLanguageCode,
    targetLanguageCode,
    fieldName,
    sourceValue,
  });

  return TranslationMemory.findOneAndUpdate(
    { sourceLanguageCode, targetLanguageCode, fieldName, sourceHash },
    {
      $set: {
        normalizedSource: canonicalizeTranslationValue(sourceValue),
        targetValue,
        approvalLevel,
        sourceTranslationRecordId: translationRecordId,
        sourceTranslationVersionId: translationVersionId,
        updatedBy: actorId,
        isArchived: false,
        archivedAt: null,
      },
      $setOnInsert: { createdBy: actorId },
    },
    { new: true, upsert: true, runValidators: true }
  );
};

export const listMemoryEntries = (filters = {}) =>
  TranslationMemory.find(filters).sort({ updatedAt: -1 }).lean();

export const updateMemoryEntry = (entryId, updates, actorId) =>
  TranslationMemory.findByIdAndUpdate(
    entryId,
    {
      $set: {
        ...(updates.targetValue !== undefined ? { targetValue: updates.targetValue } : {}),
        ...(updates.approvalLevel !== undefined ? { approvalLevel: updates.approvalLevel } : {}),
        updatedBy: actorId,
      },
    },
    { new: true, runValidators: true }
  );

export const archiveMemoryEntry = (entryId, actorId) =>
  TranslationMemory.findByIdAndUpdate(
    entryId,
    { $set: { isArchived: true, archivedAt: new Date(), updatedBy: actorId } },
    { new: true, runValidators: true }
  );
