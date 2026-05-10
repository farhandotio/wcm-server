import cron from 'node-cron';
import Listing from '../models/Listing.js';
import AuditLog from '../models/AuditLog.js';
import { calculateAndUpdateScores } from './listingScoreCalculator.js';

export const initCronJobs = () => {
  // ── Job 1: Boost Daily Income Logger ─────────────────────
  // প্রতিদিন রাত ১২:০১ মিনিটে চলবে
  cron.schedule('1 0 * * *', async () => {
    try {
      const now = new Date();
      const activeBoostListings = await Listing.find({
        'promotion.boost.isActive': true,
        'promotion.boost.expiresAt': { $gt: now },
        'promotion.boost.amountPaid': { $gt: 0 },
      });

      for (const listing of activeBoostListings) {
        const boost = listing.promotion.boost;
        const dailyEarned = Number((boost.amountPaid / (boost.durationDays || 1)).toFixed(2));

        await AuditLog.create({
          user: listing.creatorId,
          action: 'BOOST_DAILY_EARNED',
          targetType: 'Listing',
          targetId: listing._id,
          details: {
            listingTitle: listing.title,
            earnedAmount: `${dailyEarned} EUR`,
            type: 'daily_amortization',
            date: now.toISOString().split('T')[0],
          },
        });
      }
      console.log(`[Cron] Boost daily income logged for ${activeBoostListings.length} listings.`);
    } catch (err) {
      console.error('[Cron Error] Boost daily income:', err);
    }
  });

  // ── Job 2: Listing Score Updater ──────────────────────────
  // প্রতি ঘণ্টার শুরুতে চলবে (0 * * * *)
  cron.schedule('*/10 * * * *', async () => {
    console.log('[Cron] Running listing score updater...');
    await calculateAndUpdateScores();
  });

  // ── Startup: server চালু হওয়ার সাথে সাথে একবার রান ───────
  // যাতে deploy-এর পর ঘণ্টা পর্যন্ত অপেক্ষা না করতে হয়
  (async () => {
    console.log('[Cron] Running initial score calculation on startup...');
    await calculateAndUpdateScores();
  })();

  console.log('[Cron] All cron jobs initialized.');
};
