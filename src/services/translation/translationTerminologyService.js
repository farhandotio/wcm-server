import ProtectedTerm from '../../models/ProtectedTerm.js';
import TranslationDictionaryEntry from '../../models/TranslationDictionaryEntry.js';
import { normalizeTranslationText } from './translationNormalization.js';

export const listApplicableTerminology = async ({
  sourceLanguageCode,
  targetLanguageCode,
}) => {
  const [protectedTerms, dictionaryEntries] = await Promise.all([
    ProtectedTerm.find({ languageCode: sourceLanguageCode, isActive: true }).lean(),
    TranslationDictionaryEntry.find({
      sourceLanguageCode,
      targetLanguageCode,
      isActive: true,
    }).lean(),
  ]);

  return { protectedTerms, dictionaryEntries };
};

export const prepareProtectedText = (text, protectedTerms = []) => {
  if (typeof text !== 'string') {
    return { text, replacements: [] };
  }

  let protectedText = text;
  const replacements = [];

  [...protectedTerms]
    .sort((left, right) => right.term.length - left.term.length)
    .forEach((entry) => {
      const escaped = entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(escaped, entry.caseSensitive ? 'gu' : 'giu');
      protectedText = protectedText.replace(expression, (matched) => {
        const placeholder = `__WCM_PROTECTED_${replacements.length}__`;
        replacements.push({ placeholder, value: matched });
        return placeholder;
      });
    });

  return { text: protectedText, replacements };
};

export const restoreProtectedText = (text, replacements = []) => {
  if (typeof text !== 'string') {
    return text;
  }

  return replacements.reduce(
    (result, { placeholder, value }) => result.split(placeholder).join(value),
    text
  );
};

export const normalizeTerminologyFields = ({ sourceTerm, term }) => ({
  normalizedSourceTerm: sourceTerm ? normalizeTranslationText(sourceTerm).toLowerCase() : undefined,
  normalizedTerm: term ? normalizeTranslationText(term).toLowerCase() : undefined,
});
