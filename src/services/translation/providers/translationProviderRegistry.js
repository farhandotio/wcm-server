const providers = new Map();

const assertProviderContract = (provider) => {
  const requiredMethods = ['translate', 'validateConfiguration', 'getUsage', 'estimateCost'];
  const missingMethods = requiredMethods.filter((method) => typeof provider?.[method] !== 'function');

  if (missingMethods.length) {
    throw new TypeError(`Translation provider is missing: ${missingMethods.join(', ')}`);
  }
};

export const registerTranslationProvider = (name, provider) => {
  if (!name || typeof name !== 'string') {
    throw new TypeError('Translation provider name is required');
  }

  assertProviderContract(provider);
  providers.set(name, provider);
};

export const getTranslationProvider = (name = 'openai') => {
  const provider = providers.get(name);

  if (!provider) {
    const error = new Error(`Translation provider "${name}" is not configured`);
    error.code = 'TRANSLATION_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  return provider;
};

export const listTranslationProviders = () => [...providers.keys()];

export const clearTranslationProvidersForTests = () => providers.clear();
