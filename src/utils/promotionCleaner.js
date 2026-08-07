import cron from 'node-cron';
import mongoose from 'mongoose';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { calculateAndUpdateScores } from './listingScoreCalculator.js';

const startPromotionCleaner = () => {
  // প্রতিদিন রাত ১২টা (00:00) এ একবার রান করবে
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running Daily Promotion Cleaner Job...');
      const now = new Date();

      // ১. মেয়াদ উত্তীর্ণ বুস্ট অফ করা
      await Listing.updateMany(
        { 'promotion.boost.isActive': true, 'promotion.boost.expiresAt': { $lt: now } },
        { $set: { 'promotion.boost.isActive': false } }
      );

      // ২. ব্যালেন্স শেষ অথবা CPC ব্যালেন্সের চেয়ে বেশি হলে PPC অফ করা
      const listingsToDisablePpc = await Listing.find({
        'promotion.ppc.isActive': true,
        $or: [
          { 'promotion.ppc.ppcBalance': { $lte: 0 } },
          { $expr: { $lt: ['$promotion.ppc.ppcBalance', '$promotion.ppc.costPerClick'] } },
        ],
      });

      if (listingsToDisablePpc.length > 0) {
        for (const listing of listingsToDisablePpc) {
          const dbSession = await mongoose.startSession();
          try {
            dbSession.startTransaction();
            const current = await Listing.findOne({
              _id: listing._id,
              'promotion.ppc.isActive': true,
            }).session(dbSession);
            if (!current) {
              await dbSession.abortTransaction();
              continue;
            }

            const refundAmount = Number((current.promotion.ppc.ppcBalance || 0).toFixed(2));
            if (refundAmount > 0) {
              await User.findByIdAndUpdate(
                current.creatorId,
                { $inc: { walletBalance: refundAmount } },
                { session: dbSession }
              );
              await Transaction.create(
                [
                  {
                    creator: current.creatorId,
                    listing: current._id,
                    amountPaid: refundAmount,
                    currency: 'EUR',
                    fxRate: 1,
                    amountInEUR: refundAmount,
                    packageType: 'refund_ppc',
                    status: 'completed',
                    invoiceNumber: `REF-PPC-${Date.now()}-${current._id.toString().slice(-4)}`,
                  },
                ],
                { session: dbSession }
              );
            }

            current.promotion.ppc.isActive = false;
            current.promotion.ppc.isPaused = false;
            current.promotion.ppc.ppcBalance = 0;
            current.promotion.ppc.amountPaid = 0;
            current.promotion.ppc.totalClicks = 0;
            current.promotion.ppc.executedClicks = 0;
            await current.save({ session: dbSession });
            await dbSession.commitTransaction();
          } catch (error) {
            if (dbSession.inTransaction()) await dbSession.abortTransaction();
            console.error(`PPC remainder refund failed for ${listing._id}:`, error);
          } finally {
            await dbSession.endSession();
          }
        }
      }

      // ৩. যাদের বুস্ট এবং পিপিছি দুটোই অফ, তাদের isPromoted এবং level রিসেট করা
      await Listing.updateMany(
        {
          'promotion.isPromoted': true,
          'promotion.boost.isActive': false,
          'promotion.ppc.isActive': false,
        },
        { $set: { 'promotion.isPromoted': false, 'promotion.level': 0 } }
      );

      // ৪. একটিভ লিস্টিংগুলোর লেভেল রি-ক্যালকুলেশন
      const activeListings = await Listing.find({
        $or: [{ 'promotion.boost.isActive': true }, { 'promotion.ppc.isActive': true }],
      });

      if (activeListings.length > 0) {
        const bulkOps = activeListings.map((listing) => {
          let level = 0;

          // বুস্ট স্কোর
          if (listing.promotion.boost.isActive) {
            level += (listing.promotion.boost.amountPaid / 7) * 2;
          }

          // পিপিছি স্কোর
          if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
            level +=
              listing.promotion.ppc.costPerClick * 10 + listing.promotion.ppc.ppcBalance / 10;
          }

          return {
            updateOne: {
              filter: { _id: listing._id },
              update: {
                $set: {
                  'promotion.level': Math.floor(level),
                  'promotion.isPromoted':
                    (listing.promotion.boost.isActive &&
                      !listing.promotion.boost.isPaused &&
                      new Date(listing.promotion.boost.expiresAt) > now) ||
                    (listing.promotion.ppc.isActive &&
                      !listing.promotion.ppc.isPaused &&
                      listing.promotion.ppc.ppcBalance > 0),
                },
              },
            },
          };
        });
        await Listing.bulkWrite(bulkOps);
      }

      await calculateAndUpdateScores();

      console.log('Daily Promotion Cleaner Task Completed Successfully.');
    } catch (error) {
      console.error('Cron Cleaner Error:', error);
    }
  }, { timezone: 'Europe/Paris' });
};

export default startPromotionCleaner;
