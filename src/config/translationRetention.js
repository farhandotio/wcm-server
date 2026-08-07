export const TRANSLATION_HISTORY_RETENTION_YEARS = 2;

export const calculateTranslationPurgeAt = (businessObjectDeletedAt) => {
  if (!businessObjectDeletedAt) {
    return null;
  }

  const purgeAt = new Date(businessObjectDeletedAt);

  if (Number.isNaN(purgeAt.getTime())) {
    return null;
  }

  purgeAt.setUTCFullYear(
    purgeAt.getUTCFullYear() + TRANSLATION_HISTORY_RETENTION_YEARS
  );

  return purgeAt;
};
