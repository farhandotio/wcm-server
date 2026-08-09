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
import { createTranslationProposal } from './translationProposalService.js';
import { queueTranslationNotification } from './translationNotificationService.js';
import TranslationUsageEvent from '../../models/TranslationUsageEvent.js';

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
    createProposal = createTranslationProposal,
    notify = queueTranslationNotification,
    // Unit callers can process a job without a Mongo connection; production persistence
    // happens whenever the model connection is ready.
    recordUsage = (event) =>
      TranslationUsageEvent.db.readyState === 1 ? TranslationUsageEvent.create(event) : null,
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

    let usage = null;
    const startedAt = Date.now();
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
      usage = result.usage || null;
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

    const metadata = {
      ...providerMetadata,
      sourceVersion: job.sourceVersion,
      sourceHash: createTranslationHash(job.sourceContent),
      promptVersion,
      memoryHit: Boolean(memoryContent),
      origin: 'ai',
    };
    const persisted = await transaction((session) =>
      job.operation === 'regenerate'
        ? createProposal(
            {
              businessObjectType: job.businessObjectType,
              businessObjectId: job.businessObjectId,
              languageCode: job.targetLanguageCode,
              sourceVersion: job.sourceVersion,
              sourceContent: job.sourceContent,
              proposedContent: translatedContent,
              metadata,
              jobId: job.jobId,
              requestedBy: job.context?.requestedBy,
              requestedByRole: job.context?.requestedByRole,
            },
            { session }
          )
        : persist(
            {
              businessObjectType: job.businessObjectType,
              businessObjectId: job.businessObjectId,
              languageCode: job.targetLanguageCode,
              content: translatedContent,
              metadata,
              jobId: job.jobId,
            },
            { session }
          )
    );

    await completeJob(job.jobId);
    await recordUsage({
      jobId: job.jobId,
      businessObjectType: job.businessObjectType,
      businessObjectId: job.businessObjectId,
      languageCode: job.targetLanguageCode,
      provider: providerMetadata.provider,
      model: providerMetadata.model,
      outcome: 'success',
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      memoryHit: Boolean(memoryContent),
    });
    return { ...persisted, memoryHit: Boolean(memoryContent) };
  } catch (error) {
    try {
      await recordUsage({
        jobId: job.jobId,
        businessObjectType: job.businessObjectType,
        businessObjectId: job.businessObjectId,
        languageCode: job.targetLanguageCode,
        provider: providerName,
        outcome: 'failure',
        memoryHit: false,
      });
    } catch {
      // Usage monitoring must not prevent durable queue failure handling.
    }
    await failJob(job, error);
    if (job.context?.requestedBy && job.context?.requestedByRole === 'creator') {
      try {
        await notify({
          recipient: job.context.requestedBy,
          eventType: 'failed',
          businessObjectType: job.businessObjectType,
          businessObjectId: job.businessObjectId,
          languageCode: job.targetLanguageCode,
          payload: { code: 'TRANSLATION_FAILED' },
        });
      } catch {
        // Notification delivery is deliberately non-blocking for queue failure handling.
      }
    }
    throw error;
  }
};
