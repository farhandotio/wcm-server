import crypto from 'crypto';
import TranslationJob from '../../models/TranslationJob.js';
import { SOURCE_LANGUAGE_CODE, normalizeLanguageCode } from '../../config/supportedLanguages.js';
import { canonicalizeTranslationValue } from './translationNormalization.js';

export const DEFAULT_TRANSLATION_TIMEOUT_MS = 60_000;
export const DEFAULT_TRANSLATION_MAX_ATTEMPTS = 3;

export const createTranslationIdempotencyKey = ({
  operation = 'translate',
  businessObjectType,
  businessObjectId,
  targetLanguageCode,
  sourceVersion,
}) =>
  [operation, businessObjectType, businessObjectId, normalizeLanguageCode(targetLanguageCode), sourceVersion]
    .join(':');

const createJobId = (idempotencyKey) =>
  `translation-${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;

export const enqueueTranslationJob = async ({
  operation = 'translate',
  businessObjectType,
  businessObjectId,
  sourceLanguageCode = SOURCE_LANGUAGE_CODE,
  targetLanguageCode,
  sourceVersion,
  sourceContent,
  priority = 0,
  maxAttempts = DEFAULT_TRANSLATION_MAX_ATTEMPTS,
  context = {},
}) => {
  const idempotencyKey = createTranslationIdempotencyKey({
    operation,
    businessObjectType,
    businessObjectId,
    targetLanguageCode,
    sourceVersion,
  });

  const job = await TranslationJob.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        jobId: createJobId(idempotencyKey),
        idempotencyKey,
        operation,
        businessObjectType,
        businessObjectId,
        sourceLanguageCode: normalizeLanguageCode(sourceLanguageCode),
        targetLanguageCode: normalizeLanguageCode(targetLanguageCode),
        sourceVersion,
        sourceContent: JSON.parse(canonicalizeTranslationValue(sourceContent)),
        priority,
        maxAttempts,
        context,
        status: 'queued',
        availableAt: new Date(),
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  return job;
};

export const enqueueBulkTranslationJobs = (requests) =>
  Promise.all(requests.map(enqueueTranslationJob));

export const claimNextTranslationJob = async (workerId, now = new Date()) => {
  const job = await TranslationJob.findOneAndUpdate(
    {
      status: { $in: ['queued', 'retry_scheduled'] },
      availableAt: { $lte: now },
      $expr: { $lt: ['$attemptCount', '$maxAttempts'] },
    },
    {
      $set: { status: 'processing', lockedAt: now, lockedBy: workerId },
      $inc: { attemptCount: 1 },
    },
    { new: true, sort: { priority: -1, createdAt: 1 } }
  );

  if (!job) {
    return null;
  }

  job.attempts.push({
    attemptNumber: job.attemptCount,
    startedAt: now,
    outcome: 'processing',
  });
  await job.save();
  return job;
};

export const completeTranslationJob = (jobId, now = new Date()) =>
  TranslationJob.findOneAndUpdate(
    { jobId, status: 'processing' },
    {
      $set: {
        status: 'completed',
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        'attempts.$[attempt].finishedAt': now,
        'attempts.$[attempt].outcome': 'success',
      },
    },
    { new: true, arrayFilters: [{ 'attempt.outcome': 'processing' }] }
  );

export const calculateRetryDelayMs = (attemptCount, random = Math.random) => {
  const baseDelay = Math.min(1_000 * 2 ** Math.max(attemptCount - 1, 0), 30_000);
  return baseDelay + Math.floor(random() * Math.max(Math.floor(baseDelay / 2), 1));
};

export const failTranslationJob = async (
  job,
  error,
  { now = new Date(), random = Math.random } = {}
) => {
  const exhausted = job.attemptCount >= job.maxAttempts;
  const status = exhausted ? 'dead_letter' : 'retry_scheduled';
  const availableAt = exhausted
    ? now
    : new Date(now.getTime() + calculateRetryDelayMs(job.attemptCount, random));

  return TranslationJob.findOneAndUpdate(
    { jobId: job.jobId, status: 'processing' },
    {
      $set: {
        status,
        availableAt,
        lockedAt: null,
        lockedBy: null,
        'failure.code': error.code || 'TRANSLATION_JOB_FAILED',
        'failure.message': error.message,
        'attempts.$[attempt].finishedAt': now,
        'attempts.$[attempt].outcome': error.code === 'TRANSLATION_TIMEOUT' ? 'timeout' : 'failure',
        'attempts.$[attempt].errorCode': error.code || 'TRANSLATION_JOB_FAILED',
        'attempts.$[attempt].errorMessage': error.message,
      },
    },
    { new: true, arrayFilters: [{ 'attempt.outcome': 'processing' }] }
  );
};

export const getTranslationJob = (jobId) => TranslationJob.findOne({ jobId }).lean();

export const requeueStalledTranslationJobs = ({
  olderThan = new Date(Date.now() - DEFAULT_TRANSLATION_TIMEOUT_MS * 2),
} = {}) =>
  TranslationJob.updateMany(
    {
      status: 'processing',
      lockedAt: { $lte: olderThan },
      $expr: { $lt: ['$attemptCount', '$maxAttempts'] },
    },
    {
      $set: {
        status: 'retry_scheduled',
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        'failure.code': 'TRANSLATION_WORKER_STALLED',
        'failure.message': 'The previous worker lock expired',
      },
    }
  );

export const retryDeadLetterTranslationJob = (jobId) =>
  TranslationJob.findOneAndUpdate(
    { jobId, status: { $in: ['failed', 'dead_letter'] } },
    {
      $set: {
        status: 'queued',
        attemptCount: 0,
        attempts: [],
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        failure: { code: null, message: null },
      },
    },
    { new: true, runValidators: true }
  );

export const cancelTranslationJob = (jobId) =>
  TranslationJob.findOneAndUpdate(
    { jobId, status: { $in: ['queued', 'retry_scheduled'] } },
    { $set: { status: 'cancelled', lockedAt: null, lockedBy: null } },
    { new: true, runValidators: true }
  );
