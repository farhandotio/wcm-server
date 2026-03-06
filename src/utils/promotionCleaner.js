import cron from 'node-cron';
import Listing from '../models/Listing.js';

const startPromotionCleaner = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // মেয়াদ উত্তীর্ণ বুস্ট অফ করা
      await Listing.updateMany(
        { 'promotion.boost.isActive': true, 'promotion.boost.expiresAt': { $lt: now } },
        { $set: { 'promotion.boost.isActive': false } }
      );

      // ব্যালেন্স শেষ হওয়া পিপিছি অফ করা
      await Listing.updateMany(
        { 'promotion.ppc.isActive': true, 'promotion.ppc.ppcBalance': { $lte: 0 } },
        { $set: { 'promotion.ppc.isActive': false } }
      );

      // সব অফ হলে রিসেট
      await Listing.updateMany(
        { isPromoted: true, 'promotion.boost.isActive': false, 'promotion.ppc.isActive': false },
        { $set: { isPromoted: false, 'promotion.level': 0 } }
      );

      // একটিভ গুলোর লেভেল রি-ক্যালকুলেশন (শুধুমাত্র পেমেন্ট ডাটা দিয়ে)
      const activeListings = await Listing.find({ isPromoted: true });
      if (activeListings.length > 0) {
        const bulkOps = activeListings.map((listing) => {
          let level = 0;

          if (listing.promotion.boost.isActive) {
            // ১ দিনের বুস্ট ১০ ইউরো দিয়ে করলে লেভেল ২০ হবে
            level += (listing.promotion.boost.amountPaid / 7) * 2; // ডিফল্ট ৭ দিন ধরলে
          }

          if (listing.promotion.ppc.isActive) {
            // হাই সিপিসি মানে হাই লেভেল
            level +=
              listing.promotion.ppc.costPerClick * 10 + listing.promotion.ppc.ppcBalance / 10;
          }

          return {
            updateOne: {
              filter: { _id: listing._id },
              update: { $set: { 'promotion.level': Math.floor(level) } },
            },
          };
        });
        await Listing.bulkWrite(bulkOps);
      }
    } catch (error) {
      console.error('Cron Cleaner Error:', error);
    }
  });
};

export default startPromotionCleaner;
