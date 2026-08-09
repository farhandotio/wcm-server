import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import LocalizedUrlRedirect from '../../src/models/LocalizedUrlRedirect.js';
import {
  buildLocalizedPath,
  formatLocalizedMetadata,
  generateLocalizedSlug,
  normalizeLocalizedSlug,
} from '../../src/services/translation/localizedUrlService.js';

const objectId = () => new mongoose.Types.ObjectId();

test('localized slug normalization and path generation are deterministic', () => {
  assert.equal(normalizeLocalizedSlug('  Masque Africain Élégant  '), 'masque-africain-elegant');
  assert.equal(
    buildLocalizedPath({ businessObjectType: 'listing', languageCode: 'en', slug: 'Mask' }),
    '/listings/mask'
  );
  assert.equal(
    buildLocalizedPath({ businessObjectType: 'listing', languageCode: 'FR', slug: 'Masque' }),
    '/fr/listings/masque'
  );
  assert.equal(
    buildLocalizedPath({ businessObjectType: 'cms', languageCode: 'fr', slug: 'About Us' }),
    '/fr/about-us'
  );
});

test('localized slug generation skips current and permanently reserved slugs', async () => {
  const translationRecordModel = {
    exists: ({ normalizedSlug }) => Promise.resolve(normalizedSlug === 'masque'),
  };
  const redirectModel = {
    exists: ({ normalizedOldSlug }) => Promise.resolve(normalizedOldSlug === 'masque-2'),
  };

  const slug = await generateLocalizedSlug(
    { businessObjectType: 'listing', languageCode: 'fr', value: 'Masque' },
    { translationRecordModel, redirectModel }
  );

  assert.equal(slug, 'masque-3');
});

test('metadata is self-canonical with equivalent English x-default', () => {
  const alternates = [
    { languageCode: 'en', path: '/listings/mask' },
    { languageCode: 'fr', path: '/fr/listings/masque' },
  ];

  assert.deepEqual(
    formatLocalizedMetadata({ alternates, languageCode: 'fr', baseUrl: 'https://example.com/' }),
    {
      canonical: 'https://example.com/fr/listings/masque',
      languages: {
        en: 'https://example.com/listings/mask',
        fr: 'https://example.com/fr/listings/masque',
        'x-default': 'https://example.com/listings/mask',
      },
    }
  );
  assert.equal(
    formatLocalizedMetadata({
      alternates: [alternates[0]],
      languageCode: 'fr',
      baseUrl: 'https://example.com',
    }).canonical,
    'https://example.com/listings/mask'
  );
});

test('LocalizedUrlRedirect normalizes slugs and declares no-reuse uniqueness', async () => {
  const redirect = new LocalizedUrlRedirect({
    businessObjectType: 'blog',
    businessObjectId: objectId(),
    languageCode: 'FR',
    oldSlug: 'Ancien Titre',
    targetSlug: 'Nouveau Titre',
    statusCode: 308,
  });

  await redirect.validate();

  assert.equal(redirect.languageCode, 'fr');
  assert.equal(redirect.normalizedOldSlug, 'ancien-titre');
  assert.equal(redirect.normalizedTargetSlug, 'nouveau-titre');
  assert.equal(redirect.statusCode, 308);
  assert.equal(
    LocalizedUrlRedirect.schema.indexes().some(
      ([fields, options]) => fields.normalizedOldSlug === 1 && options.unique
    ),
    true
  );
});

test('LocalizedUrlRedirect rejects redirect loops', async () => {
  const redirect = new LocalizedUrlRedirect({
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    languageCode: 'fr',
    oldSlug: 'Même Slug',
    targetSlug: 'Meme Slug',
  });

  await assert.rejects(redirect.validate(), /Redirect source and target slugs must differ/);
});
