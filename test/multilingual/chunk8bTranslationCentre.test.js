import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import TranslationEditLock from '../../src/models/TranslationEditLock.js';
import TranslationJob from '../../src/models/TranslationJob.js';
import TranslationRecord from '../../src/models/TranslationRecord.js';
import TranslationPublishingPolicy from '../../src/models/TranslationPublishingPolicy.js';
import Listing from '../../src/models/Listing.js';
import { approveTranslationPublication } from '../../src/services/translation/publishingWorkflowService.js';
import { getSourceContentForObject } from '../../src/services/translation/translationSourceContentService.js';

const objectId = () => new mongoose.Types.ObjectId();

const replaceMethod = (object, name, replacement) => {
  const original = object[name];
  object[name] = replacement;
  return () => { object[name] = original; };
};

test('administrative edit lock has one lock per record and a TTL expiry index', () => {
  const uniqueIndex = TranslationEditLock.schema.indexes().find(([, options]) => options.unique === true);
  const ttlIndex = TranslationEditLock.schema.indexes().find(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0);
  assert.deepEqual(uniqueIndex[0], { translationRecordId: 1 });
  assert.ok(ttlIndex);
});

test('source content resolver uses the same Listing title and description shape as queue triggers', async () => {
  const listingId = objectId();
  const updatedAt = new Date('2026-08-10T12:00:00.000Z');
  const restore = replaceMethod(Listing, 'findById', () => ({
    lean: async () => ({ _id: listingId, title: 'English title', description: 'English description', updatedAt }),
  }));
  try {
    const source = await getSourceContentForObject({ businessObjectType: 'listing', businessObjectId: listingId });
    assert.deepEqual(source.sourceContent, { title: 'English title', description: 'English description' });
    assert.equal(source.sourceVersion, updatedAt.getTime());
  } finally {
    restore();
  }
});

test('approval is blocked for non-manual publishing policies with a typed conflict code', async () => {
  const restore = [
    replaceMethod(TranslationRecord, 'findById', () => ({
      lean: async () => ({ _id: objectId(), businessObjectType: 'creatorProfile', languageCode: 'fr' }),
    })),
    replaceMethod(TranslationPublishingPolicy, 'findOne', () => ({
      lean: async () => ({ publicationMode: 'automatic' }),
    })),
  ];
  try {
    await assert.rejects(
      approveTranslationPublication({ translationRecordId: objectId(), adminId: objectId() }),
      (error) => error.code === 'TRANSLATION_APPROVAL_NOT_APPLICABLE'
    );
  } finally {
    restore.reverse().forEach((restoreMethod) => restoreMethod());
  }
});

test('translation job schema indexes bulk operation monitoring by context and status', () => {
  const bulkIndex = TranslationJob.schema.indexes().find(([fields]) => fields['context.bulkOperationId'] === 1);
  assert.ok(bulkIndex);
  assert.deepEqual(bulkIndex[0], { 'context.bulkOperationId': 1, status: 1, createdAt: -1 });
});
