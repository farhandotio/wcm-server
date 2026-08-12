import test from 'node:test';
import assert from 'node:assert/strict';
import TranslationRecord, { TRANSLATION_STATUSES } from '../../src/models/TranslationRecord.js';
import TranslationReviewTask from '../../src/models/TranslationReviewTask.js';
import TranslationNotification, { TRANSLATION_NOTIFICATION_EVENTS } from '../../src/models/TranslationNotification.js';
import TranslationRole, { TRANSLATION_PERMISSIONS } from '../../src/models/TranslationRole.js';
import { getTranslationPermissionsForUser } from '../../src/services/translation/translationPermissionService.js';
import { resolveTranslatedObject } from '../../src/services/translation/translationService.js';

test('review workflow schemas retain rejected and returned states with task retention', () => {
  assert.ok(TRANSLATION_STATUSES.includes('rejected'));
  assert.ok(TRANSLATION_STATUSES.includes('returned_for_modification'));
  assert.equal(TranslationRecord.schema.path('translationStatus').enumValues.includes('rejected'), true);
  assert.equal(TranslationReviewTask.schema.indexes().some(([keys, options]) => keys.purgeAt === 1 && options.expireAfterSeconds === 0), true);
});

test('global admin has every dedicated multilingual permission without changing User.role', async () => {
  const permissions = await getTranslationPermissionsForUser({ _id: 'admin-id', role: 'admin' });
  assert.deepEqual(permissions, TRANSLATION_PERMISSIONS);
  assert.ok(TranslationRole.schema.path('members'));
});

test('administrative notification events remain subject to the shared preference and dedupe model', () => {
  assert.ok(TRANSLATION_NOTIFICATION_EVENTS.includes('review_requested'));
  assert.ok(TRANSLATION_NOTIFICATION_EVENTS.includes('review_assigned'));
  assert.ok(TRANSLATION_NOTIFICATION_EVENTS.includes('review_outcome'));
  assert.equal(TranslationNotification.schema.path('dedupeKey').options.unique, true);
});

test('public localized resolver exposes only translated content, slug and SEO—not review comments', async () => {
  const original = TranslationRecord.findOne;
  TranslationRecord.findOne = () => ({ lean: async () => ({ content: { title: 'Bonjour' }, slug: 'bonjour', seo: {}, internalComment: 'private' }) });
  try {
    const result = await resolveTranslatedObject({ businessObjectType: 'listing', businessObjectId: '000000000000000000000001', languageCode: 'fr', sourceContent: { title: 'Hello' } });
    assert.deepEqual(result, { content: { title: 'Bonjour' }, slug: 'bonjour', seo: {}, fallback: false });
  } finally {
    TranslationRecord.findOne = original;
  }
});
