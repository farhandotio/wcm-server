import assert from 'node:assert/strict';
import test from 'node:test';
import StaticPageTranslation from '../../src/models/StaticPageTranslation.js';
import { BUSINESS_OBJECT_REGISTRY } from '../../src/config/businessObjectRegistry.js';
import { listStaticPageDefinitions } from '../../src/config/staticPageRegistry.js';
import { boostTermsContent } from '../../src/seeds/boostTermsContent.js';
import { boostTermsFrenchContent } from '../../src/seeds/boostTermsFrenchContent.js';
import { creatorTermsContent, creatorTermsFrenchContent } from '../../src/seeds/creatorTermsContent.js';
import { privacyPolicyContent, privacyPolicyFrenchContent } from '../../src/seeds/privacyPolicyContent.js';
import {
  cookiePolicyContent,
  cookiePolicyFrenchContent,
  termsAndConditionsContent,
  termsAndConditionsFrenchContent,
} from '../../src/seeds/termsAndCookieContent.js';
import {
  seedBoostTermsFrenchTranslation,
  seedCreatorTermsTranslations,
  seedPrivacyPolicyTranslations,
  seedTermsAndCookieTranslations,
} from '../../src/services/translation/staticPageTranslationMigration.js';
import {
  getStaticPageEditor,
  hasMatchingTextStructure,
} from '../../src/services/translation/staticPageTranslationService.js';

const describeStructure = (value) => {
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return value.map(describeStructure);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, describeStructure(item)]));
  }
  return `${typeof value}:${String(value)}`;
};

const collectStrings = (value, result = []) => {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
};

test('static pages use a simple collection outside the generic Translation Engine registry', () => {
  assert.equal(Object.hasOwn(BUSINESS_OBJECT_REGISTRY, 'staticPage'), false);
  assert.deepEqual(listStaticPageDefinitions(), [
    { pageKey: 'advertising-policy', label: 'Advertising Policy' },
    { pageKey: 'boost-terms-and-ppc', label: 'Boost Terms & PPC' },
    { pageKey: 'creator-terms-and-conditions', label: 'Creator Terms & Conditions' },
    { pageKey: 'privacy-policy', label: 'Privacy Policy' },
    { pageKey: 'terms-and-conditions', label: 'Terms & Conditions' },
    { pageKey: 'cookie-policy', label: 'Cookie Policy' },
  ]);
  assert.deepEqual(
    StaticPageTranslation.schema.indexes().find(([, options]) => options.unique)?.[0],
    { pageKey: 1, languageCode: 1 }
  );
  assert.equal(StaticPageTranslation.schema.path('status').enumValues.includes('published'), true);
});

test('static-page editor returns database English beside the stored French content', async () => {
  const original = StaticPageTranslation.findOne;
  StaticPageTranslation.findOne = ({ languageCode }) => ({
    lean: async () => languageCode === 'en'
      ? { content: { hero: { title: 'Advertising' }, segments: [] }, status: 'published' }
      : { content: { hero: { title: 'Publicité' }, segments: [] }, status: 'draft', updatedAt: new Date('2026-08-12T00:00:00.000Z') },
  });
  try {
    const editor = await getStaticPageEditor({ pageKey: 'advertising-policy', languageCode: 'fr' });
    assert.equal(editor.label, 'Advertising Policy');
    assert.equal(editor.sourceContent.hero.title, 'Advertising');
    assert.equal(editor.translatedContent.hero.title, 'Publicité');
    assert.equal(editor.status, 'draft');
  } finally {
    StaticPageTranslation.findOne = original;
  }
});

test('English source can be stored and French must match its text structure', async () => {
  const record = new StaticPageTranslation({
    pageKey: 'advertising-policy', languageCode: 'en', content: { title: 'Advertising' },
  });
  await record.validate();
  assert.equal(hasMatchingTextStructure(
    { hero: { title: 'Advertising' }, segments: ['Policy text'] },
    { hero: { title: 'Publicité' }, segments: ['Texte de politique'] }
  ), true);
  assert.equal(hasMatchingTextStructure(
    { hero: { title: 'Advertising' }, segments: ['Policy text'] },
    { hero: { title: 'Publicité' }, segments: [] }
  ), false);
});

test('Boost business values remain immutable while its text can be translated', () => {
  const source = {
    businessValues: { starter: { priceEur: 12, durationDays: 7 }, ppcCostPerClickEur: 0.3 },
    sections: { hero: ['What is a Boosted Listing'] },
  };
  assert.equal(hasMatchingTextStructure(source, {
    businessValues: { starter: { priceEur: 12, durationDays: 7 }, ppcCostPerClickEur: 0.3 },
    sections: { hero: ['Qu’est-ce qu’une annonce boostée ?'] },
  }), true);
  assert.equal(hasMatchingTextStructure(source, {
    businessValues: { starter: { priceEur: 15, durationDays: 7 }, ppcCostPerClickEur: 0.3 },
    sections: { hero: ['Qu’est-ce qu’une annonce boostée ?'] },
  }), false);
});

test('Boost French seed exactly matches the English structure and immutable business values', () => {
  assert.deepEqual(describeStructure(boostTermsFrenchContent), describeStructure(boostTermsContent));
  assert.deepEqual(boostTermsFrenchContent.businessValues, boostTermsContent.businessValues);
  assert.equal(collectStrings(boostTermsContent).length, 173);
  assert.equal(collectStrings(boostTermsFrenchContent).length, 173);
  assert.equal(collectStrings(boostTermsFrenchContent).every((value) => value.trim().length > 0), true);
  assert.equal(boostTermsFrenchContent.sections.payPerClick[0].includes('Py-Per-Click'), false);
  assert.equal(boostTermsFrenchContent.sections.payPerClick[0].includes('Pay-Per-Click (PPC)'), true);
  assert.equal(boostTermsFrenchContent.sections.creatorBoost.includes('Pancark'), true);
  assert.equal(hasMatchingTextStructure(boostTermsContent, boostTermsFrenchContent), true);
});

test('startup migration inserts published Boost French only when it is missing', async () => {
  const updates = [];
  const originalStaticUpdateOne = StaticPageTranslation.updateOne;
  StaticPageTranslation.updateOne = async (...args) => { updates.push(args); return { acknowledged: true }; };
  try {
    await seedBoostTermsFrenchTranslation();
    const frenchUpdate = updates.find(([filter]) => filter.pageKey === 'boost-terms-and-ppc'
      && filter.languageCode === 'fr');
    assert.ok(frenchUpdate);
    assert.deepEqual(frenchUpdate[1], {
      $setOnInsert: {
        pageKey: 'boost-terms-and-ppc',
        languageCode: 'fr',
        content: boostTermsFrenchContent,
        status: 'published',
      },
    });
    assert.deepEqual(frenchUpdate[2], {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
    assert.equal(Object.hasOwn(frenchUpdate[1], '$set'), false);
  } finally {
    StaticPageTranslation.updateOne = originalStaticUpdateOne;
  }
});

test('Creator Terms French seed matches every English text segment', () => {
  assert.deepEqual(describeStructure(creatorTermsFrenchContent), describeStructure(creatorTermsContent));
  assert.equal(creatorTermsContent.segments.length, 200);
  assert.equal(creatorTermsFrenchContent.segments.length, 200);
  assert.equal(creatorTermsFrenchContent.segments.every((value) => value.trim().length > 0), true);
  assert.equal(creatorTermsFrenchContent.segments[creatorTermsContent.segments.indexOf('WCM')], 'WCM');
  assert.equal(
    creatorTermsFrenchContent.segments[creatorTermsContent.segments.indexOf('contact@worldculturemarketplace.com')],
    'contact@worldculturemarketplace.com'
  );
  assert.equal(hasMatchingTextStructure(creatorTermsContent, creatorTermsFrenchContent), true);
});

test('startup migration insert-only seeds published Creator Terms English and French', async () => {
  const updates = [];
  const originalStaticUpdateOne = StaticPageTranslation.updateOne;
  StaticPageTranslation.updateOne = async (...args) => { updates.push(args); return { acknowledged: true }; };
  try {
    await seedCreatorTermsTranslations();
    assert.deepEqual(updates.map(([filter]) => filter), [
      { pageKey: 'creator-terms-and-conditions', languageCode: 'en' },
      { pageKey: 'creator-terms-and-conditions', languageCode: 'fr' },
    ]);
    assert.deepEqual(updates.map(([, update]) => update.$setOnInsert.status), ['published', 'published']);
    assert.equal(updates.every(([, update]) => !Object.hasOwn(update, '$set')), true);
  } finally {
    StaticPageTranslation.updateOne = originalStaticUpdateOne;
  }
});

test('Privacy Policy French seed matches the complete English text structure', () => {
  assert.deepEqual(describeStructure(privacyPolicyFrenchContent), describeStructure(privacyPolicyContent));
  assert.equal(privacyPolicyContent.segments.length, 175);
  assert.equal(privacyPolicyFrenchContent.segments.length, 175);
  assert.equal(privacyPolicyFrenchContent.segments.every((value) => value.trim().length > 0), true);
  for (const fixedValue of ['worldculturemarketplace.com', 'contact@worldculturemarketplace.com', '06', '9.8']) {
    assert.equal(
      privacyPolicyFrenchContent.segments[privacyPolicyContent.segments.indexOf(fixedValue)],
      fixedValue
    );
  }
  assert.equal(hasMatchingTextStructure(privacyPolicyContent, privacyPolicyFrenchContent), true);
});

test('startup migration insert-only seeds published Privacy Policy English and French', async () => {
  const updates = [];
  const originalStaticUpdateOne = StaticPageTranslation.updateOne;
  StaticPageTranslation.updateOne = async (...args) => { updates.push(args); return { acknowledged: true }; };
  try {
    await seedPrivacyPolicyTranslations();
    assert.deepEqual(updates.map(([filter]) => filter), [
      { pageKey: 'privacy-policy', languageCode: 'en' },
      { pageKey: 'privacy-policy', languageCode: 'fr' },
    ]);
    assert.deepEqual(updates.map(([, update]) => update.$setOnInsert.status), ['published', 'published']);
    assert.equal(updates.every(([, update]) => !Object.hasOwn(update, '$set')), true);
  } finally {
    StaticPageTranslation.updateOne = originalStaticUpdateOne;
  }
});

test('Terms and Cookie French seeds match their complete English text structures', () => {
  for (const [englishContent, frenchContent, expectedCount] of [
    [termsAndConditionsContent, termsAndConditionsFrenchContent, 164],
    [cookiePolicyContent, cookiePolicyFrenchContent, 110],
  ]) {
    assert.deepEqual(describeStructure(frenchContent), describeStructure(englishContent));
    assert.equal(englishContent.segments.length, expectedCount);
    assert.equal(frenchContent.segments.length, expectedCount);
    assert.equal(frenchContent.segments.every((value) => value.trim().length > 0), true);
    assert.equal(hasMatchingTextStructure(englishContent, frenchContent), true);
  }
  for (const fixedValue of ['worldculturemarketplace.com', 'contact@worldculturemarketplace.com']) {
    assert.equal(
      termsAndConditionsFrenchContent.segments[termsAndConditionsContent.segments.indexOf(fixedValue)],
      fixedValue
    );
    assert.equal(cookiePolicyFrenchContent.segments[cookiePolicyContent.segments.indexOf(fixedValue)], fixedValue);
  }
});

test('startup migration insert-only seeds published Terms and Cookie English/French pairs', async () => {
  const updates = [];
  const originalStaticUpdateOne = StaticPageTranslation.updateOne;
  StaticPageTranslation.updateOne = async (...args) => { updates.push(args); return { acknowledged: true }; };
  try {
    await seedTermsAndCookieTranslations();
    assert.deepEqual(updates.map(([filter]) => filter), [
      { pageKey: 'terms-and-conditions', languageCode: 'en' },
      { pageKey: 'terms-and-conditions', languageCode: 'fr' },
      { pageKey: 'cookie-policy', languageCode: 'en' },
      { pageKey: 'cookie-policy', languageCode: 'fr' },
    ]);
    assert.equal(updates.every(([, update]) => update.$setOnInsert.status === 'published'), true);
    assert.equal(updates.every(([, update]) => !Object.hasOwn(update, '$set')), true);
  } finally {
    StaticPageTranslation.updateOne = originalStaticUpdateOne;
  }
});
