import crypto from 'crypto';
import mongoose from 'mongoose';
import LanguageConfiguration from '../../models/LanguageConfiguration.js';
import TranslationJob from '../../models/TranslationJob.js';
import Listing from '../../models/Listing.js';
import User from '../../models/User.js';
import Category from '../../models/Category.js';
import Blog from '../../models/Blog.js';
import Faq from '../../models/Faq.js';
import AboutPage from '../../models/About.js';
import { Footer } from '../../models/Footer.js';
import HowItWork from '../../models/howItWork.js';
import { getSupportedLanguage, normalizeLanguageCode, getEnabledLanguages } from '../../config/supportedLanguages.js';
import { requestTranslation } from './translationEngine.js';
import { getSourceContentForObject } from './translationSourceContentService.js';
import { retryDeadLetterTranslationJob } from './translationQueueService.js';

const sources = [['listing', Listing], ['creatorProfile', User], ['category', Category], ['blog', Blog], ['faq', Faq], ['cms', AboutPage], ['cms', Footer], ['cms', HowItWork]];
const history = (action, actor) => ({ action, actor: actor || null, at: new Date() });
const lifecycleError = (message, code = 'INVALID_LANGUAGE_LIFECYCLE') => Object.assign(new Error(message), { code });

export const seedLanguageConfigurations = async () => {
  const now = new Date();
  await LanguageConfiguration.updateOne({ code: 'en' }, { $set: { name: 'English', nativeName: 'English', direction: 'ltr', status: 'published', catalogVersion: '1', enabledAt: now, readyAt: now, publishedAt: now }, $setOnInsert: { isSource: true, history: [history('seeded', null)] } }, { upsert: true, runValidators: true });
  await LanguageConfiguration.updateOne({ code: 'fr' }, { $setOnInsert: { name: 'French', nativeName: 'Français', direction: 'ltr', isSource: false, status: 'published', catalogVersion: '1', enabledAt: now, readyAt: now, publishedAt: now, history: [history('seeded', null)] } }, { upsert: true, runValidators: true });
};

export const listLanguages = ({ publishedOnly = false } = {}) => LanguageConfiguration.find(publishedOnly ? { status: 'published' } : {}).sort({ isSource: -1, code: 1 }).lean();
export const getEnabledLanguageConfigurations = () => mongoose.connection.readyState === 0
  ? Promise.resolve(getEnabledLanguages())
  : LanguageConfiguration.find({ status: { $in: ['backfilling', 'ready', 'published'] } }).sort({ isSource: -1, code: 1 }).lean();

export const assertTranslationLanguagePair = async (source, target) => {
  const sourceCode = normalizeLanguageCode(source); const targetCode = normalizeLanguageCode(target);
  if (sourceCode !== 'en') throw lifecycleError('English is the only translation source language', 'INVALID_SOURCE_LANGUAGE');
  if (targetCode === 'en') throw lifecycleError('English source records are read-only', 'SOURCE_LANGUAGE_READ_ONLY');
  // Pure unit tests intentionally run without MongoDB; runtime requests always reach this service after startup seeding.
  if (mongoose.connection.readyState === 0) {
    const registered = getSupportedLanguage(targetCode, { enabledOnly: false });
    if (!registered || registered.isSource) throw lifecycleError('Target language is not registered and enabled', 'TARGET_LANGUAGE_DISABLED');
    return registered;
  }
  const config = await LanguageConfiguration.findOne({ code: targetCode, status: { $in: ['backfilling', 'ready', 'published'] }, isSource: false }).lean();
  if (!config) throw lifecycleError('Target language is not registered and enabled', 'TARGET_LANGUAGE_DISABLED');
  return config;
};

export const registerLanguage = async ({ code, catalogVersion = '1' }, actor) => {
  const definition = getSupportedLanguage(code, { enabledOnly: false });
  if (!definition || definition.isSource) throw lifecycleError('Language is not in the approved registry', 'UNREGISTERED_LANGUAGE');
  return LanguageConfiguration.findOneAndUpdate({ code: definition.code }, { $setOnInsert: { code: definition.code, name: definition.name, nativeName: definition.nativeName, direction: definition.direction, isSource: false, status: 'registered', catalogVersion, history: [history('registered', actor)] } }, { upsert: true, new: true, runValidators: true });
};

export const reconcileLanguageBackfill = async (code) => {
  const language = await LanguageConfiguration.findOne({ code: normalizeLanguageCode(code) });
  if (!language) throw lifecycleError('Language is not registered', 'UNREGISTERED_LANGUAGE');
  if (!language.backfillOperationId) return { language, progress: { total: 0, completed: 0, failed: 0, pending: 0 } };
  const grouped = await TranslationJob.aggregate([{ $match: { 'context.languageBackfillOperationId': language.backfillOperationId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = Object.fromEntries(grouped.map(({ _id, count }) => [_id, count])); const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const failed = (counts.failed || 0) + (counts.dead_letter || 0); const pending = total - (counts.completed || 0) - failed - (counts.cancelled || 0) - (counts.stale || 0);
  if (pending === 0 && failed === 0 && language.status === 'backfilling') { language.status = 'ready'; language.readyAt = new Date(); language.history.push(history('ready', null)); await language.save(); }
  return { language, progress: { total, completed: counts.completed || 0, failed, pending } };
};

export const enableLanguage = async (code, actor) => {
  const language = await LanguageConfiguration.findOne({ code: normalizeLanguageCode(code), isSource: false });
  if (!language) throw lifecycleError('Language is not registered', 'UNREGISTERED_LANGUAGE');
  if (['ready', 'published'].includes(language.status)) return reconcileLanguageBackfill(code);
  const operationId = language.status === 'backfilling' && language.backfillOperationId
    ? language.backfillOperationId
    : `language-backfill-${language.code}-${crypto.randomUUID()}`;
  if (language.status !== 'backfilling') {
    Object.assign(language, { status: 'backfilling', backfillOperationId: operationId, enabledAt: new Date() });
    language.history.push(history('enabled', actor));
    await language.save();
  }
  // Re-enumeration resumes a partially-created backfill; deterministic queue keys
  // prevent duplicate jobs for the same operation and object.
  for (const [businessObjectType, Model] of sources) for (const document of await Model.find({}).select('_id').lean()) {
    const source = await getSourceContentForObject({ businessObjectType, businessObjectId: document._id });
    await requestTranslation({ businessObjectType, businessObjectId: document._id, sourceLanguageCode: 'en', targetLanguageCode: language.code, sourceVersion: source.sourceVersion, sourceContent: source.sourceContent, context: { languageBackfillOperationId: operationId }, idempotencyDiscriminator: operationId });
  }
  return reconcileLanguageBackfill(code);
};

export const retryLanguageBackfill = async (code, actor) => {
  const state = await reconcileLanguageBackfill(code);
  const jobs = await TranslationJob.find({ 'context.languageBackfillOperationId': state.language.backfillOperationId, status: { $in: ['failed', 'dead_letter'] } }).select('jobId').lean();
  await Promise.all(jobs.map(({ jobId }) => retryDeadLetterTranslationJob(jobId)));
  await LanguageConfiguration.updateOne({ _id: state.language._id }, { $set: { status: 'backfilling' }, $push: { history: history('backfill_retried', actor) } });
  return enableLanguage(code, actor);
};

export const publishLanguage = async (code, actor) => {
  const state = await reconcileLanguageBackfill(code);
  if (state.progress.failed || state.progress.pending || state.language.status !== 'ready') throw lifecycleError('All backfill jobs must succeed before publication', 'LANGUAGE_NOT_READY');
  return LanguageConfiguration.findByIdAndUpdate(state.language._id, { $set: { status: 'published', publishedAt: new Date() }, $push: { history: history('published', actor) } }, { new: true });
};

export const setLanguageAvailability = async (code, action, actor) => {
  const language = await LanguageConfiguration.findOne({ code: normalizeLanguageCode(code), isSource: false });
  if (!language) throw lifecycleError('Language is not registered', 'UNREGISTERED_LANGUAGE');
  if (action === 'unpublish' && language.status !== 'published') throw lifecycleError('Only a published language can be unpublished');
  language.status = action === 'disable' ? 'disabled' : 'ready'; if (action === 'unpublish') language.publishedAt = null;
  language.history.push(history(action === 'disable' ? 'disabled' : 'unpublished', actor)); return language.save();
};
