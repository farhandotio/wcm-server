import TranslationPrompt from '../../models/TranslationPrompt.js';

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

export const getActivePrompt = async ({ key = 'default', businessObjectType = null } = {}) => {
  const scopedPrompt = await TranslationPrompt.findOne({
    key,
    businessObjectType,
    isActive: true,
  }).lean();

  if (scopedPrompt || businessObjectType === null) {
    return scopedPrompt;
  }

  return TranslationPrompt.findOne({ key, businessObjectType: null, isActive: true }).lean();
};

export const createPromptVersion = async ({
  key = 'default',
  businessObjectType = null,
  systemTemplate,
  userTemplate,
  requiredVariables = [],
  actorId,
}) => {
  const latest = await TranslationPrompt.findOne({ key, businessObjectType })
    .sort({ version: -1 })
    .select('version')
    .lean();

  return TranslationPrompt.create({
    key,
    businessObjectType,
    version: (latest?.version || 0) + 1,
    systemTemplate,
    userTemplate,
    requiredVariables,
    createdBy: actorId,
  });
};

export const activatePromptVersion = async (promptId, _actorId, { session = null } = {}) => {
  const prompt = await TranslationPrompt.findById(promptId).session(session);

  if (!prompt) {
    throw new Error('Translation prompt not found');
  }

  await TranslationPrompt.updateMany(
    { key: prompt.key, businessObjectType: prompt.businessObjectType, isActive: true },
    { $set: { isActive: false, activatedAt: null } },
    { session }
  );

  prompt.isActive = true;
  prompt.activatedAt = new Date();
  await prompt.save({ session });
  return prompt;
};

const getPath = (value, path) =>
  path.split('.').reduce((current, segment) => current?.[segment], value);

export const renderPromptTemplate = (template, variables) =>
  template.replace(VARIABLE_PATTERN, (_match, variableName) => {
    const value = getPath(variables, variableName);

    if (value === undefined || value === null) {
      throw new Error(`Missing prompt variable: ${variableName}`);
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  });

export const composeTranslationPrompt = (prompt, variables) => {
  if (!prompt) {
    throw new Error('No active translation prompt is configured');
  }

  const missingVariables = (prompt.requiredVariables || []).filter(
    (variableName) => getPath(variables, variableName) === undefined
  );

  if (missingVariables.length) {
    throw new Error(`Missing prompt variables: ${missingVariables.join(', ')}`);
  }

  return {
    system: renderPromptTemplate(prompt.systemTemplate, variables),
    user: renderPromptTemplate(prompt.userTemplate, variables),
    promptId: prompt._id,
    promptVersion: `${prompt.key}:${prompt.version}`,
  };
};
