import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  BUSINESS_OBJECT_REGISTRY,
  getCmsPageDefinition,
  validateTranslatableContent,
} from '../../src/config/businessObjectRegistry.js';
import {
  DEFAULT_LANGUAGE_CODE,
  getEnabledLanguages,
  isSupportedLanguageCode,
} from '../../src/config/supportedLanguages.js';
import { calculateTranslationPurgeAt } from '../../src/config/translationRetention.js';
import Collection from '../../src/models/Collection.js';
import TranslationAuditLog from '../../src/models/TranslationAuditLog.js';
import TranslationRecord from '../../src/models/TranslationRecord.js';
import TranslationVersion from '../../src/models/TranslationVersion.js';

const objectId = () => new mongoose.Types.ObjectId();

test('language and business object registries expose the Phase 1 contract', () => {
  assert.equal(DEFAULT_LANGUAGE_CODE, 'en');
  assert.deepEqual(
    getEnabledLanguages().map(({ code }) => code),
    ['en', 'fr']
  );
  assert.equal(isSupportedLanguageCode('FR'), true);
  assert.equal(isSupportedLanguageCode('es'), false);
  assert.deepEqual(BUSINESS_OBJECT_REGISTRY.listing.translatableFields, [
    'title',
    'description',
  ]);
  assert.deepEqual(Object.keys(BUSINESS_OBJECT_REGISTRY.cms.cmsPages), ['about', 'footer', 'how-it-works']);
  assert.deepEqual(BUSINESS_OBJECT_REGISTRY.cms.modelNames, ['AboutPage', 'Footer', 'HowItWork']);
  assert.equal(getCmsPageDefinition('about').modelName, 'AboutPage');
  assert.equal(getCmsPageDefinition('not-a-page'), null);
  assert.equal(validateTranslatableContent('listing', { title: 'Mask' }).valid, true);
  assert.equal(validateTranslatableContent('listing', {}).valid, false);
  assert.equal(validateTranslatableContent('listing', { title: '   ' }).valid, false);
  assert.deepEqual(
    validateTranslatableContent('listing', { country: 'Morocco' }).invalidFields,
    ['country']
  );
});

test('TranslationRecord validates fields and normalizes localized slugs', async () => {
  const record = new TranslationRecord({
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    languageCode: 'FR',
    content: { title: 'Masque africain', description: 'Fabriqué à la main' },
    slug: 'Masque Africain Élégant',
    metadata: { origin: 'ai', provider: 'openai', sourceVersion: 1 },
  });

  await record.validate();

  assert.equal(record.languageCode, 'fr');
  assert.equal(record.slug, 'masque-africain-elegant');
  assert.equal(record.normalizedSlug, 'masque-africain-elegant');
  assert.equal(record.publicationStatus, 'draft');
  assert.equal(record.translationStatus, 'ai_generated');

  const invalidRecord = new TranslationRecord({
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    languageCode: 'fr',
    content: { title: 'Masque', country: 'Maroc' },
    metadata: { origin: 'ai' },
  });

  await assert.rejects(invalidRecord.validate(), /Non-translatable fields: country/);
});

test('TranslationRecord declares one current record and localized slug uniqueness', () => {
  const indexes = TranslationRecord.schema.indexes();
  const objectLanguageIndex = indexes.find(
    ([fields]) => fields.businessObjectId === 1 && fields.languageCode === 1
  );
  const slugIndex = indexes.find(([fields]) => fields.normalizedSlug === 1);
  const retentionIndex = indexes.find(([fields]) => fields.purgeAt === 1);

  assert.equal(objectLanguageIndex?.[1].unique, true);
  assert.equal(slugIndex?.[1].unique, true);
  assert.equal(retentionIndex?.[1].expireAfterSeconds, 0);
});

test('retention date is exactly two years after business object deletion', async () => {
  const deletedAt = new Date('2026-08-08T00:00:00.000Z');
  const record = new TranslationRecord({
    businessObjectType: 'category',
    businessObjectId: objectId(),
    languageCode: 'fr',
    content: { title: 'Artisanat' },
    metadata: { origin: 'administrator' },
    businessObjectDeletedAt: deletedAt,
  });

  await record.validate();

  assert.equal(calculateTranslationPurgeAt(deletedAt).toISOString(), '2028-08-08T00:00:00.000Z');
  assert.equal(record.purgeAt.toISOString(), '2028-08-08T00:00:00.000Z');
});

test('TranslationVersion accepts append-only snapshots and audit requires a human actor', async () => {
  const translationRecordId = objectId();
  const businessObjectId = objectId();
  const version = new TranslationVersion({
    translationRecordId,
    businessObjectType: 'blog',
    businessObjectId,
    languageCode: 'fr',
    versionNumber: 1,
    sourceVersion: 1,
    previousValue: null,
    newValue: {
      content: { title: 'Titre', description: 'Description' },
      translationStatus: 'ai_generated',
      publicationStatus: 'draft',
      reviewLevel: 'ai_generated',
    },
    modificationSource: 'ai',
    authorSnapshot: { role: 'ai' },
  });

  await version.validate();

  const invalidAudit = new TranslationAuditLog({
    eventId: 'translation-save-test',
    eventType: 'translation.saved',
    outcome: 'success',
    businessObjectType: 'listing',
    businessObjectId,
    languageCode: 'fr',
    translationRecordId,
    actorType: 'creator',
    actorSnapshot: { role: 'creator' },
  });

  await assert.rejects(invalidAudit.validate(), /actor is required for creator events/);
});

test('Collection remains a separate non-multilingual feature', () => {
  assert.equal(Collection.schema.path('key') != null, true);
  assert.equal(Collection.schema.path('listingIds') != null, true);
  assert.equal(Collection.schema.path('name'), undefined);
  assert.equal(Collection.schema.path('description'), undefined);
  assert.equal(Collection.schema.path('slug'), undefined);
  assert.equal(BUSINESS_OBJECT_REGISTRY.collection, undefined);
});
