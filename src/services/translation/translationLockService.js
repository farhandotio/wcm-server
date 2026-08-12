import crypto from 'crypto';
import TranslationEditLock from '../../models/TranslationEditLock.js';

export const TRANSLATION_EDIT_LOCK_TTL_MS = 5 * 60 * 1000;

const createLockError = (code, message, lock = null) => {
  const error = new Error(message);
  error.code = code;
  error.lock = lock;
  return error;
};

const expirationFrom = (now) => new Date(now.getTime() + TRANSLATION_EDIT_LOCK_TTL_MS);

export const acquireEditLock = async ({ translationRecordId, adminId, now = new Date() }) => {
  const lockToken = crypto.randomUUID();
  const expiresAt = expirationFrom(now);

  try {
    const lock = await TranslationEditLock.findOneAndUpdate(
      {
        translationRecordId,
        $or: [{ expiresAt: { $lte: now } }, { lockedBy: adminId }],
      },
      {
        $set: { lockedBy: adminId, lockToken, lockedAt: now, expiresAt },
        $setOnInsert: { translationRecordId },
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    return lock;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const activeLock = await TranslationEditLock.findOne({ translationRecordId }).lean();
    throw createLockError('TRANSLATION_EDIT_LOCKED', 'Translation is being edited by another administrator', activeLock);
  }
};

export const refreshEditLock = async ({ translationRecordId, adminId, lockToken, now = new Date() }) => {
  const lock = await TranslationEditLock.findOneAndUpdate(
    { translationRecordId, lockedBy: adminId, lockToken, expiresAt: { $gt: now } },
    { $set: { expiresAt: expirationFrom(now) } },
    { new: true, runValidators: true }
  ).lean();
  if (!lock) {
    throw createLockError('TRANSLATION_EDIT_LOCK_NOT_HELD', 'Administrative edit lock is missing or expired');
  }
  return lock;
};

export const releaseEditLock = async ({ translationRecordId, adminId, lockToken }) => {
  const lock = await TranslationEditLock.findOneAndDelete({ translationRecordId, lockedBy: adminId, lockToken }).lean();
  if (!lock) {
    throw createLockError('TRANSLATION_EDIT_LOCK_NOT_HELD', 'Administrative edit lock is missing or expired');
  }
  return lock;
};

export const assertEditLock = async ({ translationRecordId, adminId, lockToken, now = new Date() }) => {
  const lock = await TranslationEditLock.findOne({
    translationRecordId,
    lockedBy: adminId,
    lockToken,
    expiresAt: { $gt: now },
  }).lean();
  if (!lock) {
    throw createLockError('TRANSLATION_EDIT_LOCK_NOT_HELD', 'An active administrative edit lock is required');
  }
  return lock;
};

export const getActiveEditLock = ({ translationRecordId, now = new Date() }) =>
  TranslationEditLock.findOne({ translationRecordId, expiresAt: { $gt: now } })
    .populate('lockedBy', 'firstName lastName username profile.displayName profile.businessName')
    .lean();
