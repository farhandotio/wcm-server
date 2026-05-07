import mongoose from 'mongoose';
import Stripe from 'stripe';
import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createAuditLog } from '../utils/logger.js';
import {
  resetBoost,
  resetPPC,
  applyPromotionLogic,
  checkAndCleanupExpiry,
} from '../utils/promotionHelper.js';
import { calculateVAT } from '../utils/vatHelper.js';
import AuditLog from '../models/AuditLog.js';
import { BOOST_PACKAGES, PPC_CONFIG } from '../constants/promotion.js';

const getExchangeRate = async (fromCurrency, toCurrency) => {
  try {
    const from = fromCurrency.toLowerCase();
    const to = toCurrency.toLowerCase();
    if (from === to) return 1;

    const response = await axios.get(
      `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/${from}/${to}`
    );
    return response.data?.conversion_rate || 1;
  } catch (error) {
    console.error('Exchange Rate Error:', error);
    return 1;
  }
};

export const createCheckoutSession = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe Secret Key is missing in Environment Variables');
    }

    const { amount, currency } = req.body;

    // ১. ইউজার ডাটা চেক
    const user = await User.findById(req.user._id);
    if (!user || !user.profile) {
      return res
        .status(400)
        .json({ message: 'Profile information missing. Please complete your profile.' });
    }

    if (!amount || amount < 5)
      return res.status(400).json({ message: 'Minimum top-up is 5 units.' });

    const paymentCurrency = (currency || 'eur').toLowerCase();

    // ২. ডাইনামিক ভ্যাট ক্যালকুলেশন
    const netAmount = Number(amount);

    // প্রোফাইল থেকে ডাটা বের করে ফাংশনে পাঠানো হচ্ছে
    // আপনার ফাংশন অনুযায়ী: calculateVAT(countryCode, isBusiness, isValidVAT)
    const vatResult = calculateVAT(
      user.profile.countryCode,
      user.profile.customerType === 'business',
      user.profile.isVatValid
    );

    const vatPercent = vatResult.rate; // রেটটি বের করে আনা হলো
    const vatAmount = (netAmount * vatPercent) / 100;
    const totalAmount = netAmount + vatAmount;

    // ৩. স্ট্রাইপ সেশন তৈরি
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: paymentCurrency,
            product_data: {
              name: `Wallet Top-up: ${user.firstName}`,
              description: `Net: ${netAmount} | VAT (${vatPercent}% - ${vatResult.type}): ${vatAmount.toFixed(2)}`,
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/creator/promotions?success=true`,
      cancel_url: `${process.env.CLIENT_URL}/creator/promotions?canceled=true`,
      metadata: {
        creatorId: user._id.toString(),
        type: 'wallet_topup',
        originalCurrency: paymentCurrency,
        netAmount: netAmount.toString(),
        vatAmount: vatAmount.toString(),
        vatRate: vatPercent.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe Error:', error);
    // এরর মেসেজ পাঠানো যাতে ফ্রন্টএন্ডে দেখা যায়
    res.status(500).json({ message: error.message || 'Server side error in payment.' });
  }
};

export const handleStripeWebhook = async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { creatorId, originalCurrency, netAmount, vatAmount, vatRate } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const totalPaid = session.amount_total / 100;
      const netPaid = Number(netAmount); // ভ্যাট ছাড়া আসল টাকা
      const vatPaid = Number(vatAmount);

      let walletCreditInEUR = 0;

      // ১. কারেন্সি কনভার্সন (যদি EUR না হয়)
      if (originalCurrency === 'eur') {
        walletCreditInEUR = netPaid; // শুধুমাত্র নেট অ্যামাউন্ট ওয়ালেটে যাবে
      } else {
        const fxRate = await getExchangeRate(originalCurrency, 'EUR');
        walletCreditInEUR = Number((netPaid * fxRate).toFixed(2));
      }

      // ২. ওয়ালেট আপডেট
      const updatedUser = await User.findByIdAndUpdate(
        creatorId,
        { $inc: { walletBalance: walletCreditInEUR } },
        { session: dbSession, new: true }
      );

      // ৩. ট্রানজেকশন রেকর্ড (Full Compliance)
      const transaction = await Transaction.create(
        [
          {
            creator: creatorId,
            stripeSessionId: session.id,
            amountPaid: totalPaid, // ইউজার যা পে করেছে (Net + VAT)
            currency: originalCurrency.toUpperCase(),
            amountInEUR: walletCreditInEUR, // ওয়ালেটে যা ঢুকেছে (Net)
            packageType: 'wallet_topup',
            status: 'completed',
            vatAmount: vatPaid, // কত ট্যাক্স কাটা হয়েছে
            invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          },
        ],
        { session: dbSession }
      );

      // ৪. অডিট লগ (ঐচ্ছিক কিন্তু ভালো প্র্যাকটিস)
      if (global.createAuditLog) {
        await createAuditLog({
          user: creatorId,
          action: 'WALLET_TOPUP_SUCCESS',
          targetId: transaction[0]._id,
          details: {
            net: `${netPaid} ${originalCurrency}`,
            vat: `${vatPaid} (${vatRate}%)`,
            credited: `${walletCreditInEUR} EUR`,
          },
        });
      }

      await dbSession.commitTransaction();
      console.log(`Credited ${walletCreditInEUR} EUR (VAT excluded) to: ${creatorId}`);
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('Webhook processing failed:', error);
    } finally {
      dbSession.endSession();
    }
  }
  res.json({ received: true });
};

export const purchasePromotion = async (req, res) => {
  const { listingId, packageType, amountInEUR, days, totalClicks, packageId } = req.body;
  const userId = req.user._id;

  //validation
  if (packageType === 'boost') {
    const validPackage = BOOST_PACKAGES[packageId];
    if (!validPackage || validPackage.price !== amountInEUR || validPackage.days !== days) {
      return res.status(400).json({ success: false, message: 'Invalid Boost Package data.' });
    }
  } else if (packageType === 'ppc') {
    if (amountInEUR < PPC_CONFIG.MIN_AMOUNT) {
      return res
        .status(400)
        .json({ success: false, message: `Minimum PPC budget is €${PPC_CONFIG.MIN_AMOUNT}` });
    }
    
    const expectedClicks = Math.floor(amountInEUR / PPC_CONFIG.COST_PER_CLICK);
    if (totalClicks !== expectedClicks) {
      return res.status(400).json({ success: false, message: 'PPC Click calculation mismatch.' });
    }
  }

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const listing = await Listing.findById(listingId).session(dbSession);
    const user = await User.findById(userId).session(dbSession);

    if (user.walletBalance < amountInEUR) throw new Error('Insufficient wallet balance.');

    // ১. ওয়ালেট থেকে টাকা কাটা
    user.walletBalance = Number((user.walletBalance - amountInEUR).toFixed(2));
    await user.save({ session: dbSession });

    if (packageType === 'boost') {
      const boostDays = parseInt(days);
      let currentExpiry =
        listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > new Date()
          ? new Date(listing.promotion.boost.expiresAt)
          : new Date();

      listing.promotion.boost.isActive = true;
      listing.promotion.boost.isPaused = false;
      listing.promotion.boost.amountPaid = (listing.promotion.boost.amountPaid || 0) + amountInEUR;
      listing.promotion.boost.durationDays =
        (listing.promotion.boost.durationDays || 0) + boostDays;

      currentExpiry.setDate(currentExpiry.getDate() + boostDays);
      listing.promotion.boost.expiresAt = currentExpiry;

      // --- নতুন লজিক: আজকের দিনের আর্নিং অডিট লগ ---
      // আজকের দিনের জন্য আর্নড অ্যামাউন্ট (আজকের অংশটুকু রিফান্ড হবে না)
      const dailyEarned = Number((amountInEUR / boostDays).toFixed(2));

      await AuditLog.create(
        [
          {
            user: userId,
            action: 'BOOST_DAILY_EARNED',
            targetType: 'Listing',
            targetId: listingId,
            details: {
              listingTitle: listing.title,
              earnedAmount: `${dailyEarned} EUR`,
              type: 'purchase_day_amortization',
              date: new Date().toISOString().split('T')[0],
              note: 'Initial day earned upon purchase',
            },
          },
        ],
        { session: dbSession }
      );
      // -------------------------------------------
    } else if (packageType === 'ppc') {
      listing.promotion.ppc.isActive = true;
      listing.promotion.ppc.isPaused = false;
      listing.promotion.ppc.ppcBalance += amountInEUR;
      listing.promotion.ppc.amountPaid += amountInEUR;
      listing.promotion.ppc.totalClicks += parseInt(totalClicks);

      listing.promotion.ppc.costPerClick = Number(
        (listing.promotion.ppc.amountPaid / listing.promotion.ppc.totalClicks).toFixed(4)
      );
    }

    applyPromotionLogic(listing);
    await listing.save({ session: dbSession });

    // ট্রানজেকশন রেকর্ড (এটা আপনার Wallet History এর জন্য)
    const transaction = await Transaction.create(
      [
        {
          creator: userId,
          listing: listingId,
          amountPaid: amountInEUR,
          amountInEUR: amountInEUR,
          currency: 'EUR',
          packageType: packageType,
          status: 'completed',
          invoiceNumber: `INT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          vatAmount: 0,
          fxRate: 1,
        },
      ],
      { session: dbSession }
    );

    await dbSession.commitTransaction();
    res.status(200).json({
      success: true,
      transactionId: transaction[0]._id,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    dbSession.endSession();
  }
};

export const togglePausePromotion = async (req, res) => {
  const { listingId, packageType } = req.body;
  try {
    const listing = await Listing.findById(listingId);
    if (packageType === 'boost') {
      listing.promotion.boost.isPaused = !listing.promotion.boost.isPaused;
    } else if (packageType === 'ppc') {
      listing.promotion.ppc.isPaused = !listing.promotion.ppc.isPaused;
    }
    applyPromotionLogic(listing);
    await listing.save();
    res.status(200).json({
      success: true,
      isPaused:
        packageType === 'boost' ? listing.promotion.boost.isPaused : listing.promotion.ppc.isPaused,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const cancelPromotion = async (req, res) => {
  const { listingId, packageType } = req.body;
  const userId = req.user._id;

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const listing = await Listing.findById(listingId).session(dbSession);
    const user = await User.findById(userId).session(dbSession);

    if (!listing) throw new Error('Listing not found');

    let refundAmount = 0;
    const now = new Date();

    if (packageType === 'boost' && listing.promotion?.boost?.isActive) {
      const boost = listing.promotion.boost;
      const expiry = new Date(boost.expiresAt);

      if (expiry > now) {
        const totalPaid = Number(boost.amountPaid) || 0;
        const totalDays = Number(boost.durationDays) || 1;

        // ১. প্রতিদিনের রেট বের করা
        const dailyRate = totalPaid / totalDays;

        // ২. কতদিন বাকি আছে (পূর্ণ দিন)
        const remainingTimeMs = expiry.getTime() - now.getTime();
        const remainingDays = Math.floor(remainingTimeMs / (24 * 60 * 60 * 1000));

        if (remainingDays > 0) {
          refundAmount = Number((remainingDays * dailyRate).toFixed(2));
        }

        // ৩. সেফটি চেক
        if (refundAmount > totalPaid) refundAmount = totalPaid;

        console.log(
          `DEBUG: Paid: ${totalPaid}, Days: ${totalDays}, Remaining: ${remainingDays}, Refund: ${refundAmount}`
        );
      }

      // ৪. রিফান্ড হোক বা না হোক, বুস্টের দিন এবং টাকা ০ করে ফ্রেশ করা (আপনার রিকোয়ারমেন্ট অনুযায়ী)
      boost.isActive = false;
      boost.isPaused = false;
      boost.amountPaid = 0;
      boost.durationDays = 0; // এখানে ০ করে দেওয়া হলো
      boost.expiresAt = null;
    } else if (packageType === 'ppc' && listing.promotion?.ppc?.isActive) {
      refundAmount = listing.promotion.ppc.ppcBalance || 0;

      // PPC রিসেট
      listing.promotion.ppc.isActive = false;
      listing.promotion.ppc.isPaused = false;
      listing.promotion.ppc.ppcBalance = 0;
      listing.promotion.ppc.amountPaid = 0;
      listing.promotion.ppc.totalClicks = 0;
      listing.promotion.ppc.executedClicks = 0;
    }

    // ৫. ওয়ালেট আপডেট এবং ট্রানজেকশন রেকর্ড
    if (refundAmount > 0) {
      user.walletBalance = Number((user.walletBalance + refundAmount).toFixed(2));
      await user.save({ session: dbSession });

      await Transaction.create(
        [
          {
            creator: userId,
            listing: listingId,
            amountPaid: refundAmount,
            currency: 'EUR',
            amountInEUR: refundAmount,
            packageType: packageType === 'boost' ? 'refund_boost' : 'refund_ppc',
            status: 'completed',
            invoiceNumber: `REF-${Date.now()}-${listingId.toString().slice(-4)}`,
          },
        ],
        { session: dbSession }
      );
    }

    // ৬. প্রমোশন লেভেল আপডেট (এখন ০ আসবে যেহেতু বুস্ট নেই)
    applyPromotionLogic(listing);
    await listing.save({ session: dbSession });

    await dbSession.commitTransaction();
    res.status(200).json({
      success: true,
      refundAmount,
      newBalance: user.walletBalance,
      message: `Refunded €${refundAmount} and boost refreshed.`,
    });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    dbSession.endSession();
  }
};

export const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id)
      .populate('creator', 'firstName lastName email profile role')
      .populate('listing', 'title');

    if (!transaction) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = transaction.creator._id.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Unauthorized access to this invoice' });
    }

    const doc = new jsPDF();
    const totalPaid = transaction.amountPaid;
    const vatAmount = transaction.vatAmount || 0;
    const currency = transaction.currency.toUpperCase();

    // --- সমস্যা এখানে ছিল: ম্যানুয়াল ক্যালকুলেশন বাদ দিয়ে ডাটাবেস থেকে রেট নিন ---
    // যদি ডাটাবেসে vatRate না থাকে তবেই কেবল ক্যালকুলেট করবে
    const netAmount = Number((totalPaid - vatAmount).toFixed(2));
    const vatRateDisplay = transaction.vatRate
      ? transaction.vatRate.toFixed(2)
      : netAmount > 0
        ? ((vatAmount / netAmount) * 100).toFixed(2)
        : '0.00';

    // --- Header Style (অপরিবর্তিত) ---
    doc.setFillColor(249, 115, 22);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('OFFICIAL INVOICE', 15, 25);
    doc.setFontSize(10);
    doc.text(process.env.BUSINESS_NAME || 'DRAKILO COLLECTIVE', 195, 25, { align: 'right' });

    // --- Details Section ---
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Invoice No:`, 15, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(transaction.invoiceNumber || `INV-${transaction._id.toString().slice(-6)}`, 40, 55);

    const formattedDate = new Date(transaction.createdAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.text(`Date: ${formattedDate}`, 15, 62);

    doc.setFont('helvetica', 'bold');
    doc.text('Bill To:', 140, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(`${transaction.creator.firstName} ${transaction.creator.lastName}`, 140, 62);
    doc.text(transaction.creator.email, 140, 68);

    // --- Table ---
    autoTable(doc, {
      startY: 80,
      head: [['Service Description', 'Net Price', 'VAT Amount', 'Total']],
      body: [
        [
          {
            content: `${transaction.packageType.replace('_', ' ').toUpperCase()}\n${transaction.listing?.title ? `Asset: ${transaction.listing.title}` : 'Wallet Top-up'}`,
            styles: { cellPadding: 5 },
          },
          `${netAmount.toFixed(2)} ${currency}`,
          `${vatAmount.toFixed(2)} (${vatRateDisplay}%)`,
          `${totalPaid.toFixed(2)} ${currency}`,
        ],
      ],
      headStyles: { fillColor: [30, 30, 30], fontStyle: 'bold' },
      styles: { fontSize: 9, valign: 'middle' },
      theme: 'grid',
    });

    const finalY = doc.lastAutoTable.finalY + 15;

    // --- Summary Section ---
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Grand Total:', 130, finalY);
    doc.text(`${totalPaid.toFixed(2)} ${currency}`, 195, finalY, { align: 'right' });

    // --- Exchange Rate Info ---
    if (currency !== 'EUR' && transaction.fxRate) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      doc.text(`Exchange Rate: 1 ${currency} = ${transaction.fxRate} EUR`, 15, finalY + 10);
      doc.text(`Accounting Value: ${transaction.amountInEUR.toFixed(2)} EUR`, 15, finalY + 15);
    }

    // --- Footer ---
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('This is a computer-generated document by Drakilo Node System.', 105, 285, {
      align: 'center',
    });

    const pdfBuffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename=Invoice-${transaction.invoiceNumber}.pdf`
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error('Invoice Gen Error:', err);
    res.status(500).json({ message: 'Error generating PDF invoice' });
  }
};