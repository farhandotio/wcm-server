import TranslationJob from '../../models/TranslationJob.js';
import TranslationUsageEvent from '../../models/TranslationUsageEvent.js';
import { listTranslationProviders } from './providers/translationProviderRegistry.js';
import { getActiveTranslationConfiguration } from './translationConfigurationService.js';

export const getTranslationOperationalHealth = async () => {
  const config = await getActiveTranslationConfiguration();
  const [jobs, usage] = await Promise.all([TranslationJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]), TranslationUsageEvent.aggregate([{ $match: { createdAt: { $gte: new Date(Date.now() - 3600000) } } }, { $group: { _id: '$outcome', count: { $sum: 1 }, averageLatencyMs: { $avg: '$latencyMs' } } }])]);
  const total = usage.reduce((n, row) => n + row.count, 0); const failures = usage.find((row) => row._id === 'failure')?.count || 0;
  return { worker: { heartbeatAt: new Date() }, provider: { active: config.provider.name, available: listTranslationProviders().includes(config.provider.name), manualFailoverOnly: true }, queue: jobs, attempts: usage, rollingFailureRatePercent: total ? (failures / total) * 100 : 0, configurationVersion: config.version };
};
