export const SOURCE_LANGUAGE_CODE = 'en';
export const DEFAULT_LANGUAGE_CODE = SOURCE_LANGUAGE_CODE;

export const SUPPORTED_LANGUAGES = Object.freeze([
  Object.freeze({
    code: 'en',
    name: 'English',
    nativeName: 'English',
    direction: 'ltr',
    enabled: true,
    isSource: true,
  }),
  Object.freeze({
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    direction: 'ltr',
    enabled: true,
    isSource: false,
  }),
]);

const languagesByCode = new Map(
  SUPPORTED_LANGUAGES.map((language) => [language.code, language])
);

export const normalizeLanguageCode = (languageCode) =>
  typeof languageCode === 'string' ? languageCode.trim().toLowerCase() : '';

export const getSupportedLanguage = (languageCode, { enabledOnly = true } = {}) => {
  const language = languagesByCode.get(normalizeLanguageCode(languageCode));

  if (!language || (enabledOnly && !language.enabled)) {
    return null;
  }

  return language;
};

export const isSupportedLanguageCode = (languageCode, options) =>
  Boolean(getSupportedLanguage(languageCode, options));

export const getEnabledLanguages = () =>
  SUPPORTED_LANGUAGES.filter((language) => language.enabled);
