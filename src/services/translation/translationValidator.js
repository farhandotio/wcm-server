import { validateTranslatableContent } from '../../config/businessObjectRegistry.js';
import { isSupportedLanguageCode } from '../../config/supportedLanguages.js';
import { normalizeTranslationText } from './translationNormalization.js';

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const containsTerm = (text, term, caseSensitive = false) => {
  if (typeof text !== 'string' || typeof term !== 'string') {
    return false;
  }

  const source = normalizeTranslationText(text);
  const expected = normalizeTranslationText(term);
  return caseSensitive
    ? source.includes(expected)
    : source.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
};

export const validateSupportedLanguage = (languageCode) => ({
  valid: isSupportedLanguageCode(languageCode),
  errors: isSupportedLanguageCode(languageCode)
    ? []
    : [{ code: 'UNSUPPORTED_LANGUAGE', field: null, message: `${languageCode} is not supported` }],
});

export const validateTranslationCompleteness = (sourceContent, translatedContent) => {
  if (!isPlainObject(sourceContent) || !isPlainObject(translatedContent)) {
    return {
      valid: false,
      errors: [{ code: 'INVALID_CONTENT', field: null, message: 'Content must be an object' }],
    };
  }

  const errors = Object.keys(sourceContent).flatMap((field) => {
    const value = translatedContent[field];
    return value === undefined || value === null || (typeof value === 'string' && !value.trim())
      ? [{ code: 'MISSING_TRANSLATION', field, message: `${field} is missing` }]
      : [];
  });

  const unexpectedFields = Object.keys(translatedContent).filter(
    (field) => !(field in sourceContent)
  );
  unexpectedFields.forEach((field) => {
    errors.push({ code: 'UNEXPECTED_FIELD', field, message: `${field} was not requested` });
  });

  return { valid: errors.length === 0, errors };
};

const compareStructure = (source, target, path, errors) => {
  if (typeof source === 'string') {
    if (typeof target !== 'string') {
      errors.push({ code: 'STRUCTURE_MISMATCH', field: path, message: `${path} must be a string` });
    }
    return;
  }

  if (Array.isArray(source)) {
    if (!Array.isArray(target) || target.length !== source.length) {
      errors.push({ code: 'STRUCTURE_MISMATCH', field: path, message: `${path} array shape changed` });
      return;
    }
    source.forEach((value, index) => compareStructure(value, target[index], `${path}.${index}`, errors));
    return;
  }

  if (isPlainObject(source)) {
    if (!isPlainObject(target)) {
      errors.push({ code: 'STRUCTURE_MISMATCH', field: path, message: `${path} object shape changed` });
      return;
    }
    Object.keys(source).forEach((key) =>
      compareStructure(source[key], target[key], path ? `${path}.${key}` : key, errors)
    );
    return;
  }

  if (typeof source !== typeof target) {
    errors.push({ code: 'STRUCTURE_MISMATCH', field: path, message: `${path} value type changed` });
  }
};

export const validateTranslationStructure = (sourceContent, translatedContent) => {
  const errors = [];
  compareStructure(sourceContent, translatedContent, '', errors);
  return { valid: errors.length === 0, errors };
};

export const validateTranslationForPublication = async ({
  businessObjectType, sourceLanguageCode, targetLanguageCode, sourceContent, translatedContent,
  dictionaryEntries = [], protectedTerms = [], sourceVersion, expectedSourceVersion, policy = null,
}) => {
  const base = validateAiTranslation({ businessObjectType, sourceLanguageCode, targetLanguageCode, sourceContent, translatedContent, dictionaryEntries, protectedTerms });
  const errors = [...base.errors];
  if (expectedSourceVersion != null && sourceVersion !== expectedSourceVersion) errors.push({ code: 'SOURCE_VERSION_MISMATCH', field: null, message: 'Source version changed before publication validation' });
  if (!policy?.publicationMode) errors.push({ code: 'PUBLISHING_POLICY_UNAVAILABLE', field: null, message: 'No active publishing policy could be resolved' });
  return { valid: errors.length === 0, errors };
};

export const validateProtectedTerms = (
  sourceContent,
  translatedContent,
  protectedTerms = []
) => {
  const sourceText = JSON.stringify(sourceContent);
  const translatedText = JSON.stringify(translatedContent);
  const errors = protectedTerms.flatMap((entry) => {
    const presentInSource = containsTerm(sourceText, entry.term, entry.caseSensitive);
    const preserved = containsTerm(translatedText, entry.term, entry.caseSensitive);
    return presentInSource && !preserved
      ? [{ code: 'PROTECTED_TERM_CHANGED', field: null, message: `${entry.term} must be preserved` }]
      : [];
  });

  return { valid: errors.length === 0, errors };
};

export const validateDictionaryCompliance = (
  sourceContent,
  translatedContent,
  dictionaryEntries = [],
  protectedTerms = []
) => {
  const sourceText = JSON.stringify(sourceContent);
  const translatedText = JSON.stringify(translatedContent);
  const protectedValues = new Set(protectedTerms.map(({ term }) => term.toLocaleLowerCase()));
  const errors = dictionaryEntries.flatMap((entry) => {
    if (protectedValues.has(entry.sourceTerm.toLocaleLowerCase())) {
      return [];
    }

    return containsTerm(sourceText, entry.sourceTerm) && !containsTerm(translatedText, entry.targetTerm)
      ? [{
          code: 'DICTIONARY_TERM_MISSING',
          field: null,
          message: `${entry.sourceTerm} must use ${entry.targetTerm}`,
        }]
      : [];
  });

  return { valid: errors.length === 0, errors };
};

export const validateAiTranslation = ({
  businessObjectType,
  sourceLanguageCode,
  targetLanguageCode,
  sourceContent,
  translatedContent,
  protectedTerms = [],
  dictionaryEntries = [],
}) => {
  const checks = [
    validateSupportedLanguage(sourceLanguageCode),
    validateSupportedLanguage(targetLanguageCode),
    validateTranslationCompleteness(sourceContent, translatedContent),
    validateTranslationStructure(sourceContent, translatedContent),
    validateProtectedTerms(sourceContent, translatedContent, protectedTerms),
    validateDictionaryCompliance(
      sourceContent,
      translatedContent,
      dictionaryEntries,
      protectedTerms
    ),
  ];
  const contentValidation = validateTranslatableContent(businessObjectType, translatedContent);

  if (!contentValidation.valid) {
    checks.push({
      valid: false,
      errors: [{
        code: 'INVALID_TRANSLATABLE_CONTENT',
        field: null,
        message: contentValidation.reason,
      }],
    });
  }

  const errors = checks.flatMap(({ errors }) => errors);
  return { valid: errors.length === 0, errors };
};
