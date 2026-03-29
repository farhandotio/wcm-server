import cron from 'node-cron';
import Listing from '../models/Listing.js'; // পাথ চেক করে নিবেন
import AuditLog from '../models/AuditLog.js';

export const initCronJobs = () => {
  // প্রতিদিন রাত ১২:০১ মিনিটে চলবে
  cron.schedule('1 0 * * *', async () => {
    try {
      const now = new Date();
      // শুধুমাত্র একটিভ এবং যেগুলোর মেয়াদ এখনো আছে এমন বুস্ট লিস্টিং
      const activeBoostListings = await Listing.find({
        'promotion.boost.isActive': true,
        'promotion.boost.expiresAt': { $gt: now },
        'promotion.boost.amountPaid': { $gt: 0 },
      });

      for (const listing of activeBoostListings) {
        const boost = listing.promotion.boost;
        // প্রতিদিনের ইনকাম = (মোট পেমেন্ট / মোট দিন)
        const dailyEarned = Number((boost.amountPaid / (boost.durationDays || 1)).toFixed(2));

        await AuditLog.create({
          user: listing.creatorId,
          action: 'BOOST_DAILY_EARNED',
          targetType: 'Listing',
          targetId: listing._id,
          details: {
            listingTitle: listing.title,
            earnedAmount: `${dailyEarned} EUR`, // এখানে স্ট্রিং রাখছি আপনার আগের ফরম্যাট অনুযায়ী
            type: 'daily_amortization',
            date: now.toISOString().split('T')[0],
          },
        });
      }
      console.log(`[Cron] Boost daily income logged for ${activeBoostListings.length} listings.`);
    } catch (err) {
      console.error('[Cron Error]:', err);
    }
  });
};
