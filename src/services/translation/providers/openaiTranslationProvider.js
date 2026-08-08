const notConfigured = () => {
  const error = new Error(
    'OpenAI translation provider is a placeholder; configure the production adapter before use'
  );
  error.code = 'TRANSLATION_PROVIDER_NOT_CONFIGURED';
  throw error;
};

export const openaiTranslationProvider = Object.freeze({
  name: 'openai',
  translate: async () => notConfigured(),
  validateConfiguration: () => ({
    valid: false,
    errors: ['OpenAI provider integration is not installed'],
  }),
  getUsage: () => null,
  estimateCost: () => null,
});

// Intentionally not registered. Production configuration will explicitly install
// this adapter after the client-owned project, model and secret are available.
export default openaiTranslationProvider;
