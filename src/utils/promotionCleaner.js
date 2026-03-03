import cron from 'node-cron';
import Listing from '../models/Listing.js';

const startPromotionCleaner = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('--- Initiating Global Promotion Protocol Clean-up ---');

    try {
      const now = new Date();

      const expiredBoosts = await Listing.updateMany(
        {
          'promotion.boost.isActive': true,
          'promotion.boost.expiresAt': { $lt: now },
        },
        { $set: { 'promotion.boost.isActive': false } }
      );

      const emptyPpc = await Listing.updateMany(
        {
          'promotion.ppc.isActive': true,
          'promotion.ppc.ppcBalance': { $lte: 0 },
        },
        { $set: { 'promotion.ppc.isActive': false } }
      );

      const listingsToSync = await Listing.find({ isPromoted: true });

      for (let listing of listingsToSync) {
        const hasActivePpc = listing.promotion?.ppc?.isActive && listing.promotion?.ppc?.ppcBalance > 0;
        const hasActiveBoost = listing.promotion?.boost?.isActive && listing.promotion?.boost?.expiresAt > now;

        if (!hasActivePpc && !hasActiveBoost) {
          listing.isPromoted = false;
        }

        const boostAmt = hasActiveBoost ? (Number(listing.promotion?.boost?.amountPaid) || 0) : 0;
        const ppcAmt = hasActivePpc ? (Number(listing.promotion?.ppc?.amountPaid) || 0) : 0;
        const viewsCount = Number(listing.views) || 0;
        const favCount = listing.favorites?.length || 0;

        listing.promotion.level = Math.floor(
          boostAmt * 1.5 + ppcAmt * 1.2 + viewsCount * 0.1 + favCount * 2
        );

        await listing.save(); 
      }

      console.log(`✅ Deactivated Expired Boosts: ${expiredBoosts.modifiedCount}`);
      console.log(`✅ Deactivated Empty PPC: ${emptyPpc.modifiedCount}`);
      console.log(`✅ Synced Rank & isPromoted status for: ${listingsToSync.length} assets`);
    } catch (error) {
      console.error('❌ Promotion Protocol Error:', error);
    }
  });
};

export default startPromotionCleaner;