import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-4o-mini';

let client;
let lastUsage = null;

const getClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY is required for the OpenAI translation provider');
    error.code = 'TRANSLATION_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
};

const translate = async ({ system, user, signal }) => {
  const response = await getClient().chat.completions.create(
    {
      model: process.env.OPENAI_TRANSLATION_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    },
    { signal }
  );
  const output = response.choices[0]?.message?.content;

  if (!output) {
    const error = new Error('OpenAI translation provider returned no content');
    error.code = 'TRANSLATION_PROVIDER_EMPTY_RESPONSE';
    throw error;
  }

  lastUsage = response.usage || null;

  return {
    content: JSON.parse(output),
    model: response.model,
    confidence: null,
  };
};

export const openaiTranslationProvider = Object.freeze({
  name: 'openai',
  translate,
  validateConfiguration: () => ({
    valid: Boolean(process.env.OPENAI_API_KEY),
    errors: process.env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY is required'],
  }),
  getUsage: () => lastUsage,
  estimateCost: () => null,
});

export default openaiTranslationProvider;
