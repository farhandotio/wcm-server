import Listing from '../models/Listing.js';

const WEIGHTS = {
  PINNED: 40,
  PPC: 20,
  BOOST: 15,
  FAVORITES: 10,
  CLICKS: 8,
  VIEWS: 5,
  RECENCY: 2,
};

const logNormalizedScore = (value, maximum, points) => {
  if (!maximum) return 0;
  return (Math.log1p(value) / Math.log1p(maximum)) * points;
};

const recencyScore = (createdAt, points, now) => {
  const ageDays = Math.max(0, now - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000);
  return points * Math.pow(0.5, ageDays / 7);
};

const getMaxima = (listings) =>
  listings.reduce(
    (maxima, listing) => ({
      maxFavorites: Math.max(maxima.maxFavorites, listing.favorites?.length || 0),
      maxClicks: Math.max(maxima.maxClicks, listing.promotion?.ppc?.executedClicks || 0),
      maxViews: Math.max(maxima.maxViews, listing.views || 0),
    }),
    { maxFavorites: 0, maxClicks: 0, maxViews: 0 }
  );

export const calculateCanonicalListingScore = (
  listing,
  { maxFavorites = 0, maxClicks = 0, maxViews = 0 } = {},
  now = Date.now()
) => {
  const promotion = listing.promotion || {};
  const pinnedPosition = promotion.pinnedPosition;
  const pinnedBonus = pinnedPosition
    ? WEIGHTS.PINNED * ((5 - pinnedPosition) / 4)
    : 0;
  const boostActive =
    promotion.boost?.isActive === true &&
    promotion.boost?.isPaused !== true &&
    new Date(promotion.boost?.expiresAt).getTime() > now;
  const ppcActive =
    promotion.ppc?.isActive === true &&
    promotion.ppc?.isPaused !== true &&
    Number(promotion.ppc?.ppcBalance || 0) > 0;

  const score =
    pinnedBonus +
    (ppcActive ? WEIGHTS.PPC : 0) +
    (boostActive ? WEIGHTS.BOOST : 0) +
    logNormalizedScore(listing.favorites?.length || 0, maxFavorites, WEIGHTS.FAVORITES) +
    logNormalizedScore(
      promotion.ppc?.executedClicks || 0,
      maxClicks,
      WEIGHTS.CLICKS
    ) +
    logNormalizedScore(listing.views || 0, maxViews, WEIGHTS.VIEWS) +
    recencyScore(listing.createdAt, WEIGHTS.RECENCY, now);

  return Number(score.toFixed(4));
};

const getApprovedScoreInputs = () =>
  Listing.find(
    { status: 'approved' },
    { _id: 1, createdAt: 1, favorites: 1, views: 1, promotion: 1 }
  ).lean();

export const recalculateListingScore = async (listingId) => {
  const listings = await getApprovedScoreInputs();
  const target = listings.find((listing) => listing._id.toString() === listingId.toString());

  if (!target) {
    await Listing.updateOne({ _id: listingId }, { $set: { score: 0 } });
    return 0;
  }

  const maxima = getMaxima(listings);
  const calculationTime = Date.now();
  const scoredListings = listings.map((listing) => ({
    id: listing._id,
    score: calculateCanonicalListingScore(listing, maxima, calculationTime),
  }));

  await Listing.bulkWrite(
    scoredListings.map(({ id, score }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { score } } },
    })),
    { ordered: false }
  );

  return scoredListings.find(({ id }) => id.toString() === listingId.toString()).score;
};

export const calculateAndUpdateScores = async () => {
  const startTime = Date.now();
  console.log('[ScoreCalc] Starting listing score calculation...');

  try {
    const listings = await getApprovedScoreInputs();
    if (!listings.length) {
      console.log('[ScoreCalc] No approved listings found. Skipping.');
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const maxima = getMaxima(listings);
    const calculationTime = Date.now();
    const operations = listings.map((listing) => ({
      updateOne: {
        filter: { _id: listing._id },
        update: {
          $set: {
            score: calculateCanonicalListingScore(listing, maxima, calculationTime),
          },
        },
      },
    }));
    const result = await Listing.bulkWrite(operations, { ordered: false });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[ScoreCalc] Done. Updated ${result.modifiedCount}/${listings.length} listings in ${elapsed}s`
    );
    return result;
  } catch (error) {
    console.error('[ScoreCalc] Error during score calculation:', error);
    throw error;
  }
};
