import mongoose from 'mongoose';
import StaticPageTranslation from '../../models/StaticPageTranslation.js';
import TranslationRecord from '../../models/TranslationRecord.js';
import TranslationVersion from '../../models/TranslationVersion.js';
import TranslationAuditLog from '../../models/TranslationAuditLog.js';
import TranslationReviewTask from '../../models/TranslationReviewTask.js';
import TranslationEditLock from '../../models/TranslationEditLock.js';
import TranslationProposal from '../../models/TranslationProposal.js';
import TranslationJob from '../../models/TranslationJob.js';
import TranslationUsageEvent from '../../models/TranslationUsageEvent.js';
import TranslationNotification from '../../models/TranslationNotification.js';
import { advertisingPolicyContent } from '../../seeds/advertisingPolicyContent.js';
import { boostTermsContent } from '../../seeds/boostTermsContent.js';
import { boostTermsFrenchContent } from '../../seeds/boostTermsFrenchContent.js';
import { creatorTermsContent, creatorTermsFrenchContent } from '../../seeds/creatorTermsContent.js';
import { privacyPolicyContent, privacyPolicyFrenchContent } from '../../seeds/privacyPolicyContent.js';
import {
  cookiePolicyContent,
  cookiePolicyFrenchContent,
  termsAndConditionsContent,
  termsAndConditionsFrenchContent,
} from '../../seeds/termsAndCookieContent.js';

const LEGACY_STATIC_PAGE_TYPE = 'staticPage';
const ADVERTISING_POLICY_OBJECT_ID = new mongoose.Types.ObjectId('000000000000000000000001');

export const seedBoostTermsFrenchTranslation = () => StaticPageTranslation.updateOne(
  { pageKey: 'boost-terms-and-ppc', languageCode: 'fr' },
  {
    $setOnInsert: {
      pageKey: 'boost-terms-and-ppc',
      languageCode: 'fr',
      content: boostTermsFrenchContent,
      status: 'published',
    },
  },
  { upsert: true, runValidators: true, setDefaultsOnInsert: true }
);

export const seedCreatorTermsTranslations = () => Promise.all([
  StaticPageTranslation.updateOne(
    { pageKey: 'creator-terms-and-conditions', languageCode: 'en' },
    { $setOnInsert: {
      pageKey: 'creator-terms-and-conditions', languageCode: 'en', content: creatorTermsContent, status: 'published',
    } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ),
  StaticPageTranslation.updateOne(
    { pageKey: 'creator-terms-and-conditions', languageCode: 'fr' },
    { $setOnInsert: {
      pageKey: 'creator-terms-and-conditions', languageCode: 'fr', content: creatorTermsFrenchContent, status: 'published',
    } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ),
]);

export const seedPrivacyPolicyTranslations = () => Promise.all([
  StaticPageTranslation.updateOne(
    { pageKey: 'privacy-policy', languageCode: 'en' },
    { $setOnInsert: {
      pageKey: 'privacy-policy', languageCode: 'en', content: privacyPolicyContent, status: 'published',
    } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ),
  StaticPageTranslation.updateOne(
    { pageKey: 'privacy-policy', languageCode: 'fr' },
    { $setOnInsert: {
      pageKey: 'privacy-policy', languageCode: 'fr', content: privacyPolicyFrenchContent, status: 'published',
    } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ),
]);

const insertPublishedStaticPagePair = ({ pageKey, englishContent, frenchContent }) => Promise.all([
  StaticPageTranslation.updateOne(
    { pageKey, languageCode: 'en' },
    { $setOnInsert: { pageKey, languageCode: 'en', content: englishContent, status: 'published' } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ),
  StaticPageTranslation.updateOne(
    { pageKey, languageCode: 'fr' },
    { $setOnInsert: { pageKey, languageCode: 'fr', content: frenchContent, status: 'published' } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ),
]);

export const seedTermsAndCookieTranslations = () => Promise.all([
  insertPublishedStaticPagePair({
    pageKey: 'terms-and-conditions',
    englishContent: termsAndConditionsContent,
    frenchContent: termsAndConditionsFrenchContent,
  }),
  insertPublishedStaticPagePair({
    pageKey: 'cookie-policy',
    englishContent: cookiePolicyContent,
    frenchContent: cookiePolicyFrenchContent,
  }),
]);

export const migrateSimpleStaticPageTranslations = async () => {
  await StaticPageTranslation.updateOne(
    { pageKey: 'advertising-policy', languageCode: 'en' },
    {
      $setOnInsert: {
        pageKey: 'advertising-policy',
        languageCode: 'en',
        content: advertisingPolicyContent,
        status: 'published',
      },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await StaticPageTranslation.updateOne(
    { pageKey: 'boost-terms-and-ppc', languageCode: 'en' },
    {
      $setOnInsert: {
        pageKey: 'boost-terms-and-ppc',
        languageCode: 'en',
        content: boostTermsContent,
        status: 'published',
      },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await seedBoostTermsFrenchTranslation();
  await seedCreatorTermsTranslations();
  await seedPrivacyPolicyTranslations();
  await seedTermsAndCookieTranslations();

  const legacyRecords = await TranslationRecord.find({
    businessObjectType: LEGACY_STATIC_PAGE_TYPE,
  }).lean();

  for (const record of legacyRecords) {
    if (String(record.businessObjectId) === String(ADVERTISING_POLICY_OBJECT_ID)
      && record.languageCode !== 'en' && record.content?.content) {
      await StaticPageTranslation.updateOne(
        { pageKey: 'advertising-policy', languageCode: record.languageCode },
        {
          $setOnInsert: {
            pageKey: 'advertising-policy',
            languageCode: record.languageCode,
            content: record.content.content,
            status: record.publicationStatus === 'published' ? 'published' : 'draft',
          },
        },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true }
      );
    }
  }

  const recordIds = legacyRecords.map(({ _id }) => _id);
  const jobs = await TranslationJob.find({ businessObjectType: LEGACY_STATIC_PAGE_TYPE }).select('jobId').lean();
  const jobIds = jobs.map(({ jobId }) => jobId);
  const byRecord = recordIds.length ? { translationRecordId: { $in: recordIds } } : { _id: null };

  await Promise.all([
    TranslationVersion.deleteMany({ $or: [byRecord, { businessObjectType: LEGACY_STATIC_PAGE_TYPE }] }),
    TranslationAuditLog.deleteMany({ $or: [byRecord, { businessObjectType: LEGACY_STATIC_PAGE_TYPE }] }),
    TranslationReviewTask.deleteMany({ $or: [byRecord, { businessObjectType: LEGACY_STATIC_PAGE_TYPE }] }),
    TranslationEditLock.deleteMany(recordIds.length ? { translationRecordId: { $in: recordIds } } : { _id: null }),
    TranslationProposal.deleteMany({ $or: [byRecord, { businessObjectType: LEGACY_STATIC_PAGE_TYPE }] }),
    TranslationUsageEvent.deleteMany(jobIds.length
      ? { $or: [{ businessObjectType: LEGACY_STATIC_PAGE_TYPE }, { jobId: { $in: jobIds } }] }
      : { businessObjectType: LEGACY_STATIC_PAGE_TYPE }),
    TranslationNotification.deleteMany({ $or: [byRecord, { businessObjectType: LEGACY_STATIC_PAGE_TYPE }] }),
    TranslationJob.deleteMany({ businessObjectType: LEGACY_STATIC_PAGE_TYPE }),
  ]);
  if (recordIds.length) await TranslationRecord.deleteMany({ _id: { $in: recordIds } });

  return { sourceSeeded: true, migrated: legacyRecords.length, cleanedJobs: jobIds.length };
};
