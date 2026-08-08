import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import ProtectedTerm from '../../src/models/ProtectedTerm.js';
import TranslationDictionaryEntry from '../../src/models/TranslationDictionaryEntry.js';
import TranslationJob from '../../src/models/TranslationJob.js';
import TranslationMemory from '../../src/models/TranslationMemory.js';
import TranslationPrompt from '../../src/models/TranslationPrompt.js';
import {
  canonicalizeTranslationValue,
  createLanguagePairHash,
  normalizeTranslationText,
} from '../../src/services/translation/translationNormalization.js';
import {
  composeTranslationPrompt,
  renderPromptTemplate,
} from '../../src/services/translation/promptService.js';
import {
  prepareProtectedText,
  restoreProtectedText,
} from '../../src/services/translation/translationTerminologyService.js';
import {
  validateAiTranslation,
  validateDictionaryCompliance,
  validateProtectedTerms,
} from '../../src/services/translation/translationValidator.js';
import {
  clearTranslationProvidersForTests,
  getTranslationProvider,
  registerTranslationProvider,
} from '../../src/services/translation/providers/translationProviderRegistry.js';
import {
  calculateRetryDelayMs,
  createTranslationIdempotencyKey,
} from '../../src/services/translation/translationQueueService.js';
import { processTranslationJob } from '../../src/services/translation/translationPipeline.js';

const objectId = () => new mongoose.Types.ObjectId();

test('Chunk 2 governance models declare normalized unique contracts', async () => {
  const actorId = objectId();
  const dictionaryEntry = new TranslationDictionaryEntry({
    sourceLanguageCode: 'en',
    targetLanguageCode: 'fr',
    sourceTerm: '  Cultural   Heritage ',
    targetTerm: 'Patrimoine culturel',
    createdBy: actorId,
    updatedBy: actorId,
  });
  const protectedTerm = new ProtectedTerm({
    languageCode: 'en',
    term: ' WCM  Platform ',
    createdBy: actorId,
    updatedBy: actorId,
  });

  await Promise.all([dictionaryEntry.validate(), protectedTerm.validate()]);

  assert.equal(dictionaryEntry.normalizedSourceTerm, 'cultural heritage');
  assert.equal(protectedTerm.normalizedTerm, 'wcm platform');
  assert.equal(TranslationMemory.schema.indexes().some(([, options]) => options.unique), true);
  assert.equal(TranslationPrompt.schema.indexes().some(([, options]) => options.name === 'one_active_prompt_per_scope'), true);
  assert.equal(TranslationJob.schema.path('attempts') != null, true);
});

test('translation normalization is stable for Unicode, whitespace and object key order', () => {
  assert.equal(normalizeTranslationText('  Café\u00a0  culture '), 'Café culture');
  assert.equal(
    canonicalizeTranslationValue({ b: ' two ', a: 'one' }),
    canonicalizeTranslationValue({ a: 'one', b: 'two' })
  );
  assert.equal(
    createLanguagePairHash({ sourceLanguageCode: 'en', targetLanguageCode: 'fr', fieldName: 'title', sourceValue: ' Mask ' }),
    createLanguagePairHash({ sourceLanguageCode: 'en', targetLanguageCode: 'fr', fieldName: 'title', sourceValue: 'Mask' })
  );
});

test('prompt composition requires variables and returns exact prompt version', () => {
  const prompt = {
    _id: objectId(),
    key: 'default',
    version: 3,
    systemTemplate: 'Translate {{sourceLanguageCode}} to {{targetLanguageCode}}.',
    userTemplate: '{{sourceContent}}',
    requiredVariables: ['sourceLanguageCode', 'targetLanguageCode', 'sourceContent'],
  };
  const composed = composeTranslationPrompt(prompt, {
    sourceLanguageCode: 'en',
    targetLanguageCode: 'fr',
    sourceContent: { title: 'Mask' },
  });

  assert.equal(composed.system, 'Translate en to fr.');
  assert.equal(composed.user, '{"title":"Mask"}');
  assert.equal(composed.promptVersion, 'default:3');
  assert.throws(() => renderPromptTemplate('{{missing}}', {}), /Missing prompt variable/);
});

test('protected terms have precedence and validator rejects terminology loss', () => {
  const terms = [{ term: 'WCM', caseSensitive: true }];
  const prepared = prepareProtectedText('Visit WCM with WCM', terms);
  assert.equal(prepared.replacements.length, 2);
  assert.equal(restoreProtectedText(prepared.text, prepared.replacements), 'Visit WCM with WCM');

  assert.equal(
    validateProtectedTerms({ title: 'Visit WCM' }, { title: 'Visitez la plateforme' }, terms).valid,
    false
  );
  assert.equal(
    validateDictionaryCompliance(
      { title: 'Cultural heritage by WCM' },
      { title: 'Patrimoine culturel par WCM' },
      [
        { sourceTerm: 'Cultural heritage', targetTerm: 'Patrimoine culturel' },
        { sourceTerm: 'WCM', targetTerm: 'Autre nom' },
      ],
      terms
    ).valid,
    true
  );
});

test('AI validator enforces supported languages, shape and registered fields', () => {
  const valid = validateAiTranslation({
    businessObjectType: 'listing',
    sourceLanguageCode: 'en',
    targetLanguageCode: 'fr',
    sourceContent: { title: 'Mask', description: 'Hand made' },
    translatedContent: { title: 'Masque', description: 'Fait main' },
  });
  const invalid = validateAiTranslation({
    businessObjectType: 'listing',
    sourceLanguageCode: 'en',
    targetLanguageCode: 'es',
    sourceContent: { title: 'Mask' },
    translatedContent: { title: '', country: 'France' },
  });

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.some(({ code }) => code === 'UNSUPPORTED_LANGUAGE'), true);
});

test('provider registry enforces interface and remains unconfigured by default', () => {
  clearTranslationProvidersForTests();
  assert.throws(() => getTranslationProvider('openai'), { code: 'TRANSLATION_PROVIDER_NOT_CONFIGURED' });
  assert.throws(() => registerTranslationProvider('invalid', { translate() {} }), /missing/);

  const provider = {
    translate: async () => ({ content: {} }),
    validateConfiguration: () => ({ valid: true }),
    getUsage: () => null,
    estimateCost: () => null,
  };
  registerTranslationProvider('mock', provider);
  assert.equal(getTranslationProvider('mock'), provider);
  clearTranslationProvidersForTests();
});

test('queue keys are deterministic and retry delay is bounded exponential jitter', () => {
  const request = {
    operation: 'translate',
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    targetLanguageCode: 'FR',
    sourceVersion: 2,
  };
  assert.equal(createTranslationIdempotencyKey(request), createTranslationIdempotencyKey(request));
  assert.equal(calculateRetryDelayMs(1, () => 0), 1000);
  assert.equal(calculateRetryDelayMs(3, () => 0.999), 5998);
});

test('pipeline skips provider on full memory hit but still validates and persists', async () => {
  const calls = [];
  const job = {
    jobId: 'translation-test-memory',
    idempotencyKey: 'memory-key',
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    sourceLanguageCode: 'en',
    targetLanguageCode: 'fr',
    sourceVersion: 1,
    sourceContent: { title: 'Mask', description: 'Hand made' },
  };

  const result = await processTranslationJob(job, {
    findMemory: async ({ fieldName }) => ({
      targetValue: fieldName === 'title' ? 'Masque' : 'Fait main',
    }),
    getTerminology: async () => ({ protectedTerms: [], dictionaryEntries: [] }),
    resolvePrompt: async () => {
      throw new Error('prompt should not be loaded');
    },
    resolveProvider: () => {
      throw new Error('provider should not be called');
    },
    transaction: async (work) => work('session'),
    persist: async (payload, options) => {
      calls.push({ payload, options });
      return { record: payload };
    },
    completeJob: async (jobId) => calls.push({ completed: jobId }),
    failJob: async () => calls.push({ failed: true }),
  });

  assert.equal(result.memoryHit, true);
  assert.deepEqual(calls[0].payload.content, { title: 'Masque', description: 'Fait main' });
  assert.equal(calls[0].payload.metadata.provider, 'translation_memory');
  assert.deepEqual(calls[1], { completed: job.jobId });
});

test('pipeline validates provider output before persistence', async () => {
  let persisted = false;
  let failed = false;
  const job = {
    jobId: 'translation-test-provider',
    idempotencyKey: 'provider-key',
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    sourceLanguageCode: 'en',
    targetLanguageCode: 'fr',
    sourceVersion: 1,
    sourceContent: { title: 'Mask' },
  };

  await assert.rejects(
    processTranslationJob(job, {
      findMemory: async () => null,
      getTerminology: async () => ({ protectedTerms: [], dictionaryEntries: [] }),
      resolvePrompt: async () => ({
        _id: objectId(),
        key: 'default',
        version: 1,
        systemTemplate: 'Translate to {{targetLanguageCode}}',
        userTemplate: '{{sourceContent}}',
        requiredVariables: [],
      }),
      resolveProvider: () => ({
        translate: async () => ({ content: { title: '' }, model: 'mock' }),
      }),
      transaction: async (work) => work(null),
      persist: async () => {
        persisted = true;
      },
      completeJob: async () => {},
      failJob: async (_job, error) => {
        failed = error.code === 'TRANSLATION_VALIDATION_FAILED';
      },
    }),
    { code: 'TRANSLATION_VALIDATION_FAILED' }
  );

  assert.equal(persisted, false);
  assert.equal(failed, true);
});
