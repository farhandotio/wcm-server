import TranslationRecord from '../../models/TranslationRecord.js';

export const calculateTranslationConfidence = ({ providerConfidence, validationValid }) => {
  if (validationValid === false) {
    return 0;
  }

  if (providerConfidence === null || providerConfidence === undefined) {
    return null;
  }

  const numericConfidence = Number(providerConfidence);
  if (!Number.isFinite(numericConfidence)) {
    return null;
  }

  return Math.min(Math.max(numericConfidence, 0), 1);
};

export const recalculateTranslationConfidence = async (
  translationRecordId,
  { validationValid = true } = {}
) => {
  const record = await TranslationRecord.findById(translationRecordId);
  if (!record) {
    throw new Error('Translation record not found');
  }

  record.metadata.confidence = calculateTranslationConfidence({
    providerConfidence: record.metadata.confidence,
    validationValid,
  });
  await record.save();
  return record.metadata.confidence;
};
