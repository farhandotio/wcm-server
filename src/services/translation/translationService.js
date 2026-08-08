import mongoose from 'mongoose';
import TranslationRecord from '../../models/TranslationRecord.js';
import { createTranslationVersion } from './translationVersionService.js';
import { recordTranslationEvent } from './translationAuditService.js';

export const snapshotTranslationRecord = (record) => {
  if (!record) {
    return null;
  }

  return {
    content: record.content,
    slug: record.slug || null,
    seo: record.seo || null,
    translationStatus: record.translationStatus,
    publicationStatus: record.publicationStatus,
    reviewLevel: record.reviewLevel,
    metadata: record.metadata,
  };
};

export const getTranslation = ({ businessObjectType, businessObjectId, languageCode }) =>
  TranslationRecord.findOne({ businessObjectType, businessObjectId, languageCode });

export const upsertTranslation = async (
  {
    businessObjectType,
    businessObjectId,
    languageCode,
    content,
    slug = null,
    seo = {},
    translationStatus = 'ai_generated',
    publicationStatus = 'draft',
    reviewLevel = 'ai_generated',
    metadata,
    modificationSource = 'ai',
    author = null,
    authorSnapshot = { role: 'ai' },
    jobId = null,
  },
  { session = null } = {}
) => {
  const current = await TranslationRecord.findOne({
    businessObjectType,
    businessObjectId,
    languageCode,
  }).session(session);

  if (current && current.metadata.sourceVersion > metadata.sourceVersion) {
    const error = new Error('A newer source version already exists');
    error.code = 'STALE_TRANSLATION_JOB';
    throw error;
  }

  if (current && modificationSource === 'ai' && current.reviewLevel !== 'ai_generated') {
    const error = new Error('AI translation cannot overwrite a human-reviewed translation');
    error.code = 'HUMAN_TRANSLATION_PROTECTED';
    throw error;
  }

  const previousValue = snapshotTranslationRecord(current);
  const record = current || new TranslationRecord({
    businessObjectType,
    businessObjectId,
    languageCode,
    metadata,
  });

  record.content = content;
  record.slug = slug;
  record.seo = seo;
  record.translationStatus = translationStatus;
  record.publicationStatus = current?.publicationStatus || publicationStatus;
  record.reviewLevel = reviewLevel;
  record.metadata = metadata;
  record.versionNumber = current ? current.versionNumber + 1 : 1;
  await record.save({ session });

  const newValue = snapshotTranslationRecord(record);
  const version = await createTranslationVersion(
    {
      translationRecordId: record._id,
      businessObjectType,
      businessObjectId,
      languageCode,
      versionNumber: record.versionNumber,
      sourceVersion: metadata.sourceVersion,
      previousValue,
      newValue,
      modificationSource,
      author,
      authorSnapshot,
    },
    { session }
  );

  await recordTranslationEvent(
    {
      eventType: 'translation.saved',
      outcome: 'success',
      businessObjectType,
      businessObjectId,
      languageCode,
      translationRecordId: record._id,
      translationVersionId: version._id,
      actorType:
        modificationSource === 'administrator'
          ? 'admin'
          : modificationSource === 'system'
            ? 'system'
            : modificationSource,
      actor: author,
      actorSnapshot: authorSnapshot,
      jobId,
      details: { sourceVersion: metadata.sourceVersion, versionNumber: record.versionNumber },
    },
    { session }
  );

  return { record, version };
};

export const runTranslationPersistenceTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const setTranslationStatus = (translationRecordId, translationStatus) =>
  TranslationRecord.findByIdAndUpdate(
    translationRecordId,
    { $set: { translationStatus } },
    { new: true, runValidators: true }
  );

export const setPublicationStatus = (translationRecordId, publicationStatus) =>
  TranslationRecord.findByIdAndUpdate(
    translationRecordId,
    { $set: { publicationStatus } },
    { new: true, runValidators: true }
  );

export const resolveTranslatedObject = async ({
  businessObjectType,
  businessObjectId,
  languageCode,
  sourceContent,
}) => {
  const record = await TranslationRecord.findOne({
    businessObjectType,
    businessObjectId,
    languageCode,
    publicationStatus: 'published',
  }).lean();

  return record
    ? { content: record.content, slug: record.slug, seo: record.seo, fallback: false }
    : { content: sourceContent, slug: null, seo: null, fallback: true };
};
