import TranslationVersion from '../../models/TranslationVersion.js';

export const createTranslationVersion = (version, { session = null } = {}) =>
  TranslationVersion.create([version], { session }).then(([created]) => created);

export const getTranslationVersion = (translationRecordId, versionNumber) =>
  TranslationVersion.findOne({ translationRecordId, versionNumber }).lean();

export const listTranslationVersions = (translationRecordId) =>
  TranslationVersion.find({ translationRecordId }).sort({ versionNumber: -1 }).lean();
