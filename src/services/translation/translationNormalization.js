import crypto from 'crypto';

export const normalizeTranslationText = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
    : value;

const canonicalize = (value) => {
  if (typeof value === 'string') {
    return normalizeTranslationText(value);
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }

  return value;
};

export const canonicalizeTranslationValue = (value) =>
  JSON.stringify(canonicalize(value));

export const createTranslationHash = (value) =>
  crypto.createHash('sha256').update(canonicalizeTranslationValue(value)).digest('hex');

export const createLanguagePairHash = ({
  sourceLanguageCode,
  targetLanguageCode,
  fieldName,
  sourceValue,
}) =>
  createTranslationHash({
    sourceLanguageCode: normalizeTranslationText(sourceLanguageCode)?.toLowerCase(),
    targetLanguageCode: normalizeTranslationText(targetLanguageCode)?.toLowerCase(),
    fieldName: normalizeTranslationText(fieldName),
    sourceValue,
  });
