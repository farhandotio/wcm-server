import { getActivePrompt, composeTranslationPrompt } from './promptService.js';
import { findApprovedExactMatch } from './translationMemoryService.js';
import { listApplicableTerminology } from './translationTerminologyService.js';
import { getTranslationProvider } from './providers/translationProviderRegistry.js';
import { validateAiTranslation } from './translationValidator.js';
import {
  runTranslationPersistenceTransaction,
  upsertTranslation,
} from './translationService.js';
import {
  completeTranslationJob,
  DEFAULT_TRANSLATION_TIMEOUT_MS,
  failTranslationJob,
} from './translationQueueService.js';
import { createTranslationHash } from './translationNormalization.js';

const callProviderWithTimeout = async (provider, payload, timeoutMs) => {
  const abortController = new AbortController();
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      const error = new Error(`Translation provider timed out after ${timeoutMs}ms`);
      error.code = 'TRANSLATION_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.translate({ ...payload, signal: abortController.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const resolveMemoryContent = async (job, findMemory) => {
  const entries = await Promise.all(
    Object.entries(job.sourceContent).map(async ([fieldName, sourceValue]) => [
      fieldName,
      await findMemory({
        sourceLanguageCode: job.sourceLanguageCode,
        targetLanguageCode: job.targetLanguageCode,
        fieldName,
        sourceValue,
      }),
    ])
  );

  return entries.every(([, entry]) => entry)
    ? Object.fromEntries(entries.map(([fieldName, entry]) => [fieldName, entry.targetValue]))
    : null;
};

export const processTranslationJob = async (
  job,
  {
    providerName = 'openai',
    timeoutMs = DEFAULT_TRANSLATION_TIMEOUT_MS,
    findMemory = findApprovedExactMatch,
    getTerminology = listApplicableTerminology,
    resolvePrompt = getActivePrompt,
    resolveProvider = getTranslationProvider,
    validate = validateAiTranslation,
    persist = upsertTranslation,
    transaction = runTranslationPersistenceTransaction,
    completeJob = completeTranslationJob,
    failJob = failTranslationJob,
  } = {}
) => {
  try {
    const memoryContent = await resolveMemoryContent(job, findMemory);
    const terminology = await getTerminology({
      sourceLanguageCode: job.sourceLanguageCode,
      targetLanguageCode: job.targetLanguageCode,
    });

    let translatedContent = memoryContent;
    let providerMetadata = { provider: 'translation_memory', model: null, confidence: 1 };
    let promptVersion = null;

    if (!translatedContent) {
      const prompt = await resolvePrompt({ businessObjectType: job.businessObjectType });
      const composedPrompt = composeTranslationPrompt(prompt, {
        sourceLanguageCode: job.sourceLanguageCode,
        targetLanguageCode: job.targetLanguageCode,
        businessObjectType: job.businessObjectType,
        sourceContent: job.sourceContent,
        dictionaryEntries: terminology.dictionaryEntries,
        protectedTerms: terminology.protectedTerms,
      });
      const provider = resolveProvider(providerName);
      const result = await callProviderWithTimeout(
        provider,
        {
          ...composedPrompt,
          sourceContent: job.sourceContent,
          sourceLanguageCode: job.sourceLanguageCode,
          targetLanguageCode: job.targetLanguageCode,
          terminology,
        },
        timeoutMs
      );
      translatedContent = result.content;
      promptVersion = composedPrompt.promptVersion;
      providerMetadata = {
        provider: providerName,
        model: result.model || null,
        confidence: result.confidence ?? null,
      };
    }

    const validation = validate({
      businessObjectType: job.businessObjectType,
      sourceLanguageCode: job.sourceLanguageCode,
      targetLanguageCode: job.targetLanguageCode,
      sourceContent: job.sourceContent,
      translatedContent,
      ...terminology,
    });

    if (!validation.valid) {
      const error = new Error('Translation validation failed');
      error.code = 'TRANSLATION_VALIDATION_FAILED';
      error.validationErrors = validation.errors;
      throw error;
    }

    const persisted = await transaction((session) =>
      persist(
        {
          businessObjectType: job.businessObjectType,
          businessObjectId: job.businessObjectId,
          languageCode: job.targetLanguageCode,
          content: translatedContent,
          metadata: {
            ...providerMetadata,
            sourceVersion: job.sourceVersion,
            sourceHash: createTranslationHash(job.sourceContent),
            promptVersion,
            memoryHit: Boolean(memoryContent),
            origin: 'ai',
          },
          jobId: job.jobId,
        },
        { session }
      )
    );

    await completeJob(job.jobId);
    return { ...persisted, memoryHit: Boolean(memoryContent) };
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
};
