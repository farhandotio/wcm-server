import TranslationOperationalConfig from '../../models/TranslationOperationalConfig.js';
import { getTranslationProvider } from './providers/translationProviderRegistry.js';
import { recordOperationalEvent } from './translationOperationalLogService.js';

export const DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION = Object.freeze({ provider: { name: 'openai', metadata: {} }, queue: { timeoutMs: 60000, maxAttempts: 3 }, alerts: { queuedOrRetryThreshold: 25, rollingFailureRatePercent: 10 }, retentionDays: 730 });
const assertNonSecretMetadata = (metadata) => {
  const forbidden = Object.keys(metadata || {}).find((key) => /(secret|api[_-]?key|token|password|credential)/i.test(key));
  if (forbidden) throw Object.assign(new Error('Provider secrets must remain deployment environment variables'), { code: 'TRANSLATION_PROVIDER_SECRET_FORBIDDEN' });
};
export const getActiveTranslationConfiguration = async () => {
  if (TranslationOperationalConfig.db.readyState !== 1) return { version: 0, ...DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION, isDefault: true };
  return (await TranslationOperationalConfig.findOne({ isActive: true }).lean()) || { version: 0, ...DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION, isDefault: true };
};
export const createConfigurationVersion = async ({ configuration, actorId }) => {
  const providerName = configuration?.provider?.name || DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION.provider.name;
  assertNonSecretMetadata(configuration?.provider?.metadata);
  const provider = getTranslationProvider(providerName);
  const valid = await provider.validateConfiguration(configuration?.provider?.metadata || {});
  if (valid === false || valid?.valid === false) throw Object.assign(new Error('Translation provider configuration is invalid'), { code: 'TRANSLATION_PROVIDER_CONFIGURATION_INVALID', validationErrors: valid?.errors });
  const latest = await TranslationOperationalConfig.findOne().sort({ version: -1 }).lean();
  const created = await TranslationOperationalConfig.create({ ...DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION, ...configuration, provider: { ...DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION.provider, ...configuration?.provider, metadata: configuration?.provider?.metadata || {} }, queue: { ...DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION.queue, ...configuration?.queue }, alerts: { ...DEFAULT_TRANSLATION_OPERATIONAL_CONFIGURATION.alerts, ...configuration?.alerts }, version: (latest?.version || 0) + 1, createdBy: actorId });
  await recordOperationalEvent({ eventType: 'configuration.created', metadata: { version: created.version, provider: providerName } });
  return created;
};
export const activateConfigurationVersion = async (configurationId, actorId) => {
  const config = await TranslationOperationalConfig.findById(configurationId);
  if (!config) throw Object.assign(new Error('Translation configuration not found'), { code: 'TRANSLATION_CONFIGURATION_NOT_FOUND' });
  await TranslationOperationalConfig.updateMany({ isActive: true }, { $set: { isActive: false, activatedAt: null } });
  config.isActive = true; config.activatedAt = new Date(); config.activatedBy = actorId; await config.save();
  await recordOperationalEvent({ eventType: 'configuration.activated', metadata: { version: config.version, provider: config.provider.name } });
  return config;
};
