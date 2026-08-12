import crypto from 'crypto';
import {
  claimNextTranslationJob,
  requeueStalledTranslationJobs,
} from './translationQueueService.js';
import { processTranslationJob } from './translationPipeline.js';
import { evaluateOperationalAlerts } from './translationAlertService.js';

let timer = null;
let running = false;

export const runTranslationQueuePoll = async ({ workerId, maxJobs = 10 } = {}) => {
  if (running) return { skipped: true, processed: 0 };
  running = true;
  let processed = 0;
  try {
    await requeueStalledTranslationJobs();
    await evaluateOperationalAlerts();
    while (processed < maxJobs) {
      const job = await claimNextTranslationJob(workerId);
      if (!job) break;
      try {
        await processTranslationJob(job);
      } catch (error) {
        console.error(`Translation job ${job.jobId} failed:`, error.message);
      }
      processed += 1;
    }
    return { skipped: false, processed };
  } finally {
    running = false;
  }
};

export const startTranslationQueuePoller = ({
  intervalMs = Number(process.env.TRANSLATION_QUEUE_POLL_INTERVAL_MS) || 1_000,
  workerId = `api-${process.pid}-${crypto.randomUUID()}`,
  maxJobs = Number(process.env.TRANSLATION_QUEUE_MAX_JOBS_PER_POLL) || 10,
} = {}) => {
  if (timer) return () => clearInterval(timer);
  const poll = () => runTranslationQueuePoll({ workerId, maxJobs }).catch((error) => {
    console.error('Translation queue poll failed:', error.message);
  });
  poll();
  timer = setInterval(poll, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    timer = null;
  };
};
