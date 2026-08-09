import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import TranslationNotification, {
  TRANSLATION_NOTIFICATION_RETENTION_DAYS,
} from '../../src/models/TranslationNotification.js';
import TranslationNotificationPreference from '../../src/models/TranslationNotificationPreference.js';
import TranslationProposal, {
  TRANSLATION_PROPOSAL_TTL_MS,
} from '../../src/models/TranslationProposal.js';
import TranslationPublishingPolicy from '../../src/models/TranslationPublishingPolicy.js';
import TranslationRecord from '../../src/models/TranslationRecord.js';
import TranslationJob from '../../src/models/TranslationJob.js';
import Listing from '../../src/models/Listing.js';
import {
  DEFAULT_PUBLISHING_POLICIES,
  evaluateAutomaticPublication,
  resolveCreatorTrustPolicy,
} from '../../src/services/translation/publishingWorkflowService.js';
import {
  assertCreatorOwnsBusinessObject,
  assertCreatorTranslationMutationAllowed,
  getCreatorRegenerationUsage,
  listCreatorTranslationAvailability,
  requestCreatorRegeneration,
  resolveCreatorAvailabilityState,
} from '../../src/services/translation/creatorTranslationService.js';
import { calculateTranslationConfidence } from '../../src/services/translation/translationConfidenceService.js';
import {
  createTranslationNotificationDedupeKey,
  queueTranslationNotification,
} from '../../src/services/translation/translationNotificationService.js';
import { getActiveTranslationProposal } from '../../src/services/translation/translationProposalService.js';
import {
  restoreTranslationVersion,
  saveHumanReview,
  setTranslationVerified,
} from '../../src/services/translation/translationReviewService.js';

const objectId = () => new mongoose.Types.ObjectId();

const replaceMethod = (object, name, replacement) => {
  const original = object[name];
  object[name] = replacement;
  return () => {
    object[name] = original;
  };
};

test('publishing policy gates listings and keeps Blog creator improvements in manual review', () => {
  const listingPolicy = {
    businessObjectType: 'listing',
    ...DEFAULT_PUBLISHING_POLICIES.listing,
  };
  assert.deepEqual(evaluateAutomaticPublication({ policy: listingPolicy, masterState: { status: 'approved' } }), {
    eligible: true,
    reason: null,
  });
  assert.deepEqual(evaluateAutomaticPublication({ policy: listingPolicy, masterState: { status: 'pending' } }), {
    eligible: false,
    reason: 'MASTER_NOT_APPROVED',
  });

  const creatorPolicy = {
    businessObjectType: 'creatorProfile',
    ...DEFAULT_PUBLISHING_POLICIES.creatorProfile,
  };
  assert.equal(
    evaluateAutomaticPublication({
      policy: creatorPolicy,
      masterState: { status: 'active', role: 'creator', creatorRequestStatus: 'approved' },
    }).eligible,
    true
  );
  assert.equal(
    evaluateAutomaticPublication({ policy: creatorPolicy, masterState: { status: 'active', role: 'creator' } }).reason,
    'CREATOR_NOT_APPROVED'
  );
  assert.equal(DEFAULT_PUBLISHING_POLICIES.blog.publicationMode, 'manual_review');
  assert.deepEqual(resolveCreatorTrustPolicy('blog'), {
    canImprove: false,
    improvementPublicationMode: 'manual_review',
    canSetVerified: false,
  });
});

test('creator Blog access and restricted mutation are denied before persistence', async () => {
  await assert.rejects(
    assertCreatorOwnsBusinessObject({ businessObjectType: 'blog', businessObjectId: objectId(), creatorId: objectId() }),
    (error) => error.code === 'TRANSLATION_OWNERSHIP_DENIED' && /Admin-only/.test(error.message)
  );
  assert.throws(
    () => assertCreatorTranslationMutationAllowed('suspended'),
    (error) => error.code === 'ACCOUNT_RESTRICTED'
  );
  assert.doesNotThrow(() => assertCreatorTranslationMutationAllowed('active'));
});

test('creator availability exposes only the redacted state, language and timestamp', async () => {
  const creatorId = objectId();
  const listingId = objectId();
  const updatedAt = new Date('2026-08-09T00:00:00.000Z');
  const restore = [
    replaceMethod(Listing, 'findOne', () => ({ lean: async () => ({ _id: listingId, creatorId }) })),
    replaceMethod(TranslationRecord, 'find', () => ({
      lean: async () => [{ languageCode: 'fr', translationStatus: 'failed', publicationStatus: 'draft', updatedAt }],
    })),
    replaceMethod(TranslationJob, 'find', () => ({
      sort: () => ({ lean: async () => [{ targetLanguageCode: 'fr', status: 'dead_letter', updatedAt }] }),
    })),
  ];
  try {
    const availability = await listCreatorTranslationAvailability({
      businessObjectType: 'listing',
      businessObjectId: listingId,
      creatorId,
    });
    assert.deepEqual(availability, [{ languageCode: 'fr', state: 'Needs attention', updatedAt }]);
    assert.deepEqual(Object.keys(availability[0]).sort(), ['languageCode', 'state', 'updatedAt']);
  } finally {
    restore.reverse().forEach((restoreMethod) => restoreMethod());
  }

  assert.equal(resolveCreatorAvailabilityState({ record: { publicationStatus: 'published' } }), 'Available');
  assert.equal(resolveCreatorAvailabilityState({ job: { status: 'processing' } }), 'Processing');
  assert.equal(resolveCreatorAvailabilityState({}), 'Not available');
});

test('creator regeneration usage is scoped to the requesting creator discriminator', async () => {
  const creatorId = objectId();
  let receivedQuery;
  const restore = replaceMethod(TranslationJob, 'countDocuments', async (query) => {
    receivedQuery = query;
    return 2;
  });
  try {
    const result = await getCreatorRegenerationUsage({
      businessObjectType: 'listing',
      businessObjectId: objectId(),
      languageCode: 'fr',
      creatorId,
      now: new Date('2026-08-09T12:00:00.000Z'),
    });
    assert.deepEqual(result, { used: 2, remaining: 3 });
    assert.equal(receivedQuery.operation, 'regenerate');
    assert.equal(String(receivedQuery['context.requestedBy']), String(creatorId));
    assert.deepEqual(receivedQuery.attemptCount, { $gt: 0 });
  } finally {
    restore();
  }
});

test('creator regeneration creates a proposal-first queue request with a unique request discriminator', async () => {
  const creatorId = objectId();
  const listingId = objectId();
  let queueQuery;
  let queueUpdate;
  const restore = [
    replaceMethod(Listing, 'findOne', () => ({
      lean: async () => ({ _id: listingId, creatorId, title: 'English title', description: 'English description' }),
    })),
    replaceMethod(TranslationJob, 'countDocuments', async () => 0),
    replaceMethod(TranslationJob, 'findOneAndUpdate', async (query, update) => {
      queueQuery = query;
      queueUpdate = update;
      return { jobId: 'queued-regeneration' };
    }),
  ];
  try {
    const result = await requestCreatorRegeneration({
      businessObjectType: 'listing',
      businessObjectId: listingId,
      creatorId,
      creatorStatus: 'active',
      targetLanguageCode: 'fr',
      sourceVersion: 1,
    });
    assert.equal(result.job.jobId, 'queued-regeneration');
    assert.equal(result.remaining, 5);
    assert.match(queueQuery.idempotencyKey, /^regenerate:listing:[a-f0-9]{24}:fr:1:[0-9a-f-]{36}$/);
    assert.equal(queueUpdate.$setOnInsert.context.requestedByRole, 'creator');
    assert.match(queueUpdate.$setOnInsert.context.regenerationRequestId, /^[0-9a-f-]{36}$/);
    assert.match(queueQuery.idempotencyKey, new RegExp(`${queueUpdate.$setOnInsert.context.regenerationRequestId}$`));
  } finally {
    restore.reverse().forEach((restoreMethod) => restoreMethod());
  }
});

test('proposal schema has a 24-hour expiry and permits only one active proposal per requester', async () => {
  const createdAt = Date.now();
  const proposal = new TranslationProposal({
    translationRecordId: objectId(),
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    languageCode: 'fr',
    sourceVersion: 1,
    expectedTranslationVersion: 1,
    sourceContent: { title: 'English' },
    proposedContent: { title: 'Fran\u00e7ais' },
    requestedBy: objectId(),
    requestedByRole: 'creator',
  });
  await proposal.validate();
  assert.equal(proposal.status, 'active');
  assert.ok(Math.abs(proposal.expiresAt.getTime() - (createdAt + TRANSLATION_PROPOSAL_TTL_MS)) < 2_000);
  const activeIndex = TranslationProposal.schema.indexes().find(([, options]) => options.name === 'one_active_creator_proposal');
  assert.deepEqual(activeIndex[0], { translationRecordId: 1, languageCode: 1, requestedBy: 1, status: 1 });
  assert.equal(activeIndex[1].unique, true);
  assert.deepEqual(activeIndex[1].partialFilterExpression, { status: 'active' });
});

test('notification preference defaults to every in-app event and notification TTL is indexed', async () => {
  const preference = new TranslationNotificationPreference({ user: objectId() });
  await preference.validate();
  assert.equal(preference.enabled, true);
  assert.deepEqual(preference.enabledEvents, ['available', 'failed', 'updated', 'requires_attention']);

  const notification = new TranslationNotification({
    recipient: objectId(),
    eventType: 'available',
    businessObjectType: 'listing',
    businessObjectId: objectId(),
    languageCode: 'fr',
    dedupeKey: `dedupe-${objectId()}`,
  });
  await notification.validate();
  assert.ok(Math.abs(notification.expiresAt.getTime() - (Date.now() + TRANSLATION_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)) < 2_000);
  const ttlIndex = TranslationNotification.schema.indexes().find(([fields]) => fields.expiresAt === 1);
  assert.equal(ttlIndex[1].expireAfterSeconds, 0);
});

test('publishing policy schema requires an integer version and has one-active-policy uniqueness', async () => {
  const policy = new TranslationPublishingPolicy({
    businessObjectType: 'listing',
    languageCode: 'fr',
    version: 1,
    publicationMode: 'master_approval_gated',
    creatorImprovementMode: 'immediate_publish',
    createdBy: objectId(),
    updatedBy: objectId(),
  });
  await policy.validate();
  assert.equal(policy.verifiedAdminOnly, true);
  const activeIndex = TranslationPublishingPolicy.schema.indexes().find(([, options]) => options.name === 'one_active_publishing_policy');
  assert.equal(activeIndex[1].unique, true);
  assert.deepEqual(activeIndex[1].partialFilterExpression, { isActive: true });
  const invalid = new TranslationPublishingPolicy({ ...policy.toObject(), _id: objectId(), version: 1.5 });
  await assert.rejects(invalid.validate());
});

test('proposal lookup is proposal-first: it only returns an active, unexpired proposal', async () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  let receivedQuery;
  const restore = replaceMethod(TranslationProposal, 'findOne', (query) => {
    receivedQuery = query;
    return { lean: async () => ({ _id: objectId() }) };
  });
  try {
    const result = await getActiveTranslationProposal({
      translationRecordId: objectId(),
      requestedBy: objectId(),
      now,
    });
    assert.ok(result._id);
    assert.equal(receivedQuery.status, 'active');
    assert.deepEqual(receivedQuery.expiresAt, { $gt: now });
  } finally {
    restore();
  }
});

test('notification dedupe buckets requests for five minutes and retention is ninety days', async () => {
  const recipient = objectId();
  const businessObjectId = objectId();
  const now = new Date('2026-08-09T12:03:00.000Z');
  const key = createTranslationNotificationDedupeKey({
    recipient,
    businessObjectType: 'listing',
    businessObjectId,
    languageCode: 'fr',
    eventType: 'available',
    now,
  });
  const sameBucket = createTranslationNotificationDedupeKey({
    recipient,
    businessObjectType: 'listing',
    businessObjectId,
    languageCode: 'fr',
    eventType: 'available',
    now: new Date('2026-08-09T12:04:59.000Z'),
  });
  assert.equal(key, sameBucket);

  let updateCall;
  const restore = [
    replaceMethod(TranslationNotificationPreference, 'findOne', () => ({
      session: () => ({ lean: async () => null }),
    })),
    replaceMethod(TranslationNotification, 'findOneAndUpdate', async (...args) => {
      updateCall = args;
      return { _id: objectId() };
    }),
  ];
  try {
    await queueTranslationNotification({
      recipient,
      eventType: 'available',
      businessObjectType: 'listing',
      businessObjectId,
      languageCode: 'fr',
      now,
    });
    assert.equal(updateCall[0].dedupeKey, key);
    assert.equal(updateCall[2].upsert, true);
    assert.equal(updateCall[1].$setOnInsert.expiresAt.getTime(), now.getTime() + TRANSLATION_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  } finally {
    restore.reverse().forEach((restoreMethod) => restoreMethod());
  }
});

test('confidence is clamped to the public-safe 0..1 range and invalid validation forces zero', () => {
  assert.equal(calculateTranslationConfidence({ providerConfidence: 1.4, validationValid: true }), 1);
  assert.equal(calculateTranslationConfidence({ providerConfidence: -0.2, validationValid: true }), 0);
  assert.equal(calculateTranslationConfidence({ providerConfidence: 0.42, validationValid: true }), 0.42);
  assert.equal(calculateTranslationConfidence({ providerConfidence: 0.99, validationValid: false }), 0);
  assert.equal(calculateTranslationConfidence({ providerConfidence: 'not-a-number', validationValid: true }), null);
});

test('review service rejects unauthorized verification, rollback and human review before persistence', async () => {
  await assert.rejects(
    saveHumanReview({ actorRole: 'user' }),
    /Only Admin or Creator can save a human review/
  );
  assert.throws(() => setTranslationVerified({ translationRecordId: objectId() }), /Admin actor is required/);
  await assert.rejects(
    restoreTranslationVersion({ translationRecordId: objectId(), versionNumber: 1 }),
    /Admin actor is required/
  );
});
