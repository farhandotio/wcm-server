import cron from 'node-cron';
import Listing from '../models/Listing.js';
import AuditLog from '../models/AuditLog.js';
import { calculateAndUpdateScores } from './listingScoreCalculator.js';
import { backupDB } from './dbBackup.js';

export const initCronJobs = () => {
  // ── Job 1: Boost Daily Income Logger ─────────────────────
  // every night at 12:01
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

  // Every Night at 00:00 AM (Midnight)
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('[Cron] Starting Nightly Automated Backup Sequence...');
      const result = await backupDB();
      console.log(`[Cron] Successfully backed up to ${result.fileName}`);
    } catch (error) {
      console.error('[Cron] Automated Backup Failed:', error);
    }
  });

  // ── Job 2: Listing Score Updater ──────────────────────────
  // every hour (0 * * * *)
  cron.schedule('*/10 * * * *', async () => {
    console.log('[Cron] Running listing score updater...');
    await calculateAndUpdateScores();
  });

  // ── Startup: server
  (async () => {
    console.log('[Cron] Running initials cron jobs...');
    await calculateAndUpdateScores();
  })();

  console.log('[Cron] All cron jobs initialized.');
};;
