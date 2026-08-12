import TranslationOperationalLog from '../../models/TranslationOperationalLog.js';
import mongoose from 'mongoose';

const redact = (value) => {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(content|prompt|secret|key|token)/i.test(key)));
};
export const recordOperationalEvent = ({ eventType, outcome = 'info', jobId = null, provider = null, metadata = {}, now = new Date() }) => {
  // Pipeline unit tests and maintenance commands may intentionally run without MongoDB.
  // Operational telemetry must never change the outcome of the translation operation.
  if (mongoose.connection.readyState === 0) return Promise.resolve(null);
  return TranslationOperationalLog.create({ eventType, outcome, jobId, provider, metadata: redact(metadata), expiresAt: new Date(now.getTime() + 730 * 86400000) })
    .catch(() => null);
};
export const listTranslationOperationalLogs = (query = {}) => TranslationOperationalLog.find({ ...(query.eventType ? { eventType: query.eventType } : {}), ...(query.outcome ? { outcome: query.outcome } : {}) }).sort({ createdAt: -1 }).limit(Math.min(Number(query.limit) || 100, 200)).lean();
