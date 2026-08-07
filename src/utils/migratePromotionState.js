import Listing from '../models/Listing.js';

const effectivePromotionExpression = {
  $or: [
    {
      $and: [
        { $eq: ['$promotion.boost.isActive', true] },
        { $ne: ['$promotion.boost.isPaused', true] },
        { $gt: ['$promotion.boost.expiresAt', '$$NOW'] },
      ],
    },
    {
      $and: [
        { $eq: ['$promotion.ppc.isActive', true] },
        { $ne: ['$promotion.ppc.isPaused', true] },
        { $gt: ['$promotion.ppc.ppcBalance', 0] },
      ],
    },
  ],
};

export const migratePromotionState = async () => {
  const filter = {
    $or: [
      { isPromoted: { $exists: true } },
      { 'promotion.isPromoted': { $exists: false } },
      {
        $expr: {
          $ne: [{ $ifNull: ['$promotion.isPromoted', false] }, effectivePromotionExpression],
        },
      },
    ],
  };

  const result = await Listing.collection.updateMany(filter, [
    { $set: { 'promotion.isPromoted': effectivePromotionExpression } },
    { $unset: 'isPromoted' },
  ]);

  const indexes = await Listing.collection.indexes();
  const legacyIndex = indexes.find(
    (index) => index.key?.isPromoted === 1 && Object.keys(index.key).length === 1
  );
  if (legacyIndex) await Listing.collection.dropIndex(legacyIndex.name);
  await Listing.collection.createIndex(
    { 'promotion.isPromoted': 1 },
    { name: 'promotion.isPromoted_1' }
  );

  console.log(`Promotion state migration complete: ${result.modifiedCount} listing(s) normalized.`);
};

