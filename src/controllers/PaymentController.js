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
      return res.status(400).json({ message: 'Profile information missing. Please complete your profile.' });
    }

    if (!user.profile?.countryCode) {
      return res.status(400).json({
        message: 'Please add your country in profile before making a payment.'
      });
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
      let fxRate = 1;

      if (originalCurrency === 'eur') {
        walletCreditInEUR = netPaid;
      } else {
        fxRate = await getExchangeRate(originalCurrency, 'EUR');
        // API fail হলে fxRate = 1 থাকবে
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
            amountPaid: totalPaid,
            currency: originalCurrency.toUpperCase(),
            amountInEUR: walletCreditInEUR,
            packageType: 'wallet_topup',
            status: 'completed',
            vatAmount: vatPaid,
            invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            fxRate: fxRate,
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
      if (amountInEUR < PPC_CONFIG.MIN_AMOUNT) {
        return res
          .status(400)
          .json({ success: false, message: `Minimum PPC budget is €${PPC_CONFIG.MIN_AMOUNT}` });
      }

      const calculatedClicks = Math.floor(amountInEUR / PPC_CONFIG.COST_PER_CLICK);

      listing.promotion.ppc.isActive = true;
      listing.promotion.ppc.isPaused = false;
      listing.promotion.ppc.ppcBalance += amountInEUR;
      listing.promotion.ppc.amountPaid += amountInEUR;
      listing.promotion.ppc.totalClicks += calculatedClicks;

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
    const pageWidth = doc.internal.pageSize.getWidth();   // 210
    const pageHeight = doc.internal.pageSize.getHeight(); // 297

    const totalPaid = transaction.amountPaid;
    const vatAmount = transaction.vatAmount || 0;
    const currency = transaction.currency.toUpperCase();
    const netAmount = Number((totalPaid - vatAmount).toFixed(2));
    const vatRateDisplay = transaction.vatRate
      ? transaction.vatRate.toFixed(2)
      : netAmount > 0
        ? ((vatAmount / netAmount) * 100).toFixed(2)
        : '0.00';

    // ─────────────────────────────────────────────
    // HEADER BACKGROUND — dark charcoal top bar
    // ─────────────────────────────────────────────
    doc.setFillColor(20, 20, 20);
    doc.rect(0, 0, pageWidth, 45, 'F');

    // Orange accent strip at bottom of header
    doc.setFillColor(249, 115, 22);
    doc.rect(0, 42, pageWidth, 3, 'F');

    // ─────────────────────────────────────────────
    // WCM LOGO — Left side (drawn logo block)
    // ─────────────────────────────────────────────
    // Outer orange rounded square
    doc.setFillColor(249, 115, 22);
    doc.roundedRect(10, 6, 28, 28, 3, 3, 'F');

    // Inner white "WCM" text
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('WCM', 24, 17, { align: 'center' });

    // Small tagline under logo letters
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text('EST. 2024', 24, 22, { align: 'center' });

    // Decorative dot pattern (3 small circles)
    doc.setFillColor(255, 255, 255);
    doc.circle(19, 27, 1.2, 'F');
    doc.circle(24, 27, 1.2, 'F');
    doc.circle(29, 27, 1.2, 'F');

    // ─────────────────────────────────────────────
    // SITE NAME — Right side
    // ─────────────────────────────────────────────
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('World Culture Market Place', pageWidth - 12, 18, { align: 'right' });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    doc.text(process.env.BUSINESS_WEBSITE || 'www.worldculturemarketplace.com', pageWidth - 12, 25, { align: 'right' });
    doc.text(process.env.BUSINESS_EMAIL || 'support@wcm.com', pageWidth - 12, 31, { align: 'right' });

    // ─────────────────────────────────────────────
    // INVOICE TITLE SECTION
    // ─────────────────────────────────────────────
    // Light gray background for invoice info
    doc.setFillColor(248, 248, 248);
    doc.rect(0, 48, pageWidth, 38, 'F');

    // Left: INVOICE label + number
    doc.setTextColor(249, 115, 22);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', 15, 63);

    doc.setTextColor(80, 80, 80);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`# ${transaction.invoiceNumber || `INV-${transaction._id.toString().slice(-6).toUpperCase()}`}`, 15, 72);

    const formattedDate = new Date(transaction.createdAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    const formattedTime = new Date(transaction.createdAt).toLocaleString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(`Issued: ${formattedDate} at ${formattedTime}`, 15, 80);

    // Right: STATUS BADGE
    const statusColors = {
      completed: [34, 197, 94],
      pending: [234, 179, 8],
      failed: [239, 68, 68],
    };
    const statusLabel = (transaction.status || 'completed').toUpperCase();
    const [sr, sg, sb] = statusColors[transaction.status] || [34, 197, 94];
    doc.setFillColor(sr, sg, sb);
    doc.roundedRect(pageWidth - 50, 55, 38, 12, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(statusLabel, pageWidth - 31, 63, { align: 'center' });

    // ─────────────────────────────────────────────
    // DIVIDER
    // ─────────────────────────────────────────────
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.line(15, 90, pageWidth - 15, 90);

    // ─────────────────────────────────────────────
    // BILL TO / PAYMENT DETAILS SECTION
    // ─────────────────────────────────────────────
    // Left: Bill To
    doc.setTextColor(249, 115, 22);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO', 15, 100);

    doc.setDrawColor(249, 115, 22);
    doc.setLineWidth(0.8);
    doc.line(15, 102, 45, 102);

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${transaction.creator.firstName} ${transaction.creator.lastName}`, 15, 110);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(transaction.creator.email, 15, 117);
    if (transaction.creator.role) {
      doc.text(`Role: ${transaction.creator.role.charAt(0).toUpperCase() + transaction.creator.role.slice(1)}`, 15, 123);
    }

    // Right: Payment Summary Box
    doc.setFillColor(20, 20, 20);
    doc.roundedRect(pageWidth - 80, 93, 68, 36, 3, 3, 'F');

    doc.setTextColor(249, 115, 22);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYMENT SUMMARY', pageWidth - 46, 101, { align: 'center' });

    doc.setTextColor(180, 180, 180);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Net Amount:', pageWidth - 78, 110);
    doc.text('VAT:', pageWidth - 78, 117);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text(`${netAmount.toFixed(2)} ${currency}`, pageWidth - 14, 110, { align: 'right' });
    doc.text(`${vatAmount.toFixed(2)} ${currency}`, pageWidth - 14, 117, { align: 'right' });

    // Total inside dark box
    doc.setDrawColor(249, 115, 22);
    doc.setLineWidth(0.4);
    doc.line(pageWidth - 78, 120, pageWidth - 14, 120);

    doc.setTextColor(249, 115, 22);
    doc.setFontSize(9);
    doc.text('TOTAL:', pageWidth - 78, 127);
    doc.setFontSize(10);
    doc.text(`${totalPaid.toFixed(2)} ${currency}`, pageWidth - 14, 127, { align: 'right' });

    // ─────────────────────────────────────────────
    // ITEMS TABLE
    // ─────────────────────────────────────────────
    autoTable(doc, {
      startY: 137,
      head: [['#', 'Service Description', 'Net Price', 'VAT', 'Total']],
      body: [
        [
          '01',
          {
            content: `${transaction.packageType.replace(/_/g, ' ').toUpperCase()}\n${transaction.listing?.title ? `Asset: ${transaction.listing.title}` : 'Wallet Top-up'}`,
            styles: { cellPadding: { top: 5, right: 5, bottom: 5, left: 5 } },
          },
          `${netAmount.toFixed(2)} ${currency}`,
          `${vatAmount.toFixed(2)}\n(${vatRateDisplay}%)`,
          `${totalPaid.toFixed(2)} ${currency}`,
        ],
      ],
      headStyles: {
        fillColor: [20, 20, 20],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'center',
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 12 },
        1: { cellWidth: 80 },
        2: { halign: 'right', cellWidth: 30 },
        3: { halign: 'center', cellWidth: 30 },
        4: { halign: 'right', cellWidth: 35, fontStyle: 'bold' },
      },
      bodyStyles: {
        fontSize: 9,
        valign: 'middle',
        textColor: [40, 40, 40],
      },
      alternateRowStyles: { fillColor: [252, 252, 252] },
      styles: { lineColor: [220, 220, 220], lineWidth: 0.3 },
      theme: 'grid',
    });

    const finalY = doc.lastAutoTable.finalY;

    // ─────────────────────────────────────────────
    // GRAND TOTAL ROW
    // ─────────────────────────────────────────────
    doc.setFillColor(249, 115, 22);
    doc.rect(pageWidth - 90, finalY + 5, 78, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('GRAND TOTAL:', pageWidth - 88, finalY + 14);
    doc.setFontSize(12);
    doc.text(`${totalPaid.toFixed(2)} ${currency}`, pageWidth - 14, finalY + 14, { align: 'right' });

    // ─────────────────────────────────────────────
    // EXCHANGE RATE INFO (if applicable)
    // ─────────────────────────────────────────────
    if (currency !== 'EUR' && transaction.fxRate) {
      doc.setFillColor(255, 247, 237);
      doc.roundedRect(15, finalY + 24, 100, 16, 2, 2, 'F');
      doc.setDrawColor(249, 115, 22);
      doc.setLineWidth(0.4);
      doc.roundedRect(15, finalY + 24, 100, 16, 2, 2, 'S');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 80, 40);
      doc.text(`Exchange Rate: 1 ${currency} = ${transaction.fxRate} EUR`, 20, finalY + 32);
      doc.text(`Accounting Value: ${transaction.amountInEUR.toFixed(2)} EUR`, 20, finalY + 38);
    }

    // ─────────────────────────────────────────────
    // NOTES / TERMS SECTION
    // ─────────────────────────────────────────────
    const notesY = finalY + (currency !== 'EUR' && transaction.fxRate ? 48 : 28);

    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.4);
    doc.line(15, notesY, pageWidth - 15, notesY);

    doc.setTextColor(249, 115, 22);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('TERMS & CONDITIONS', 15, notesY + 8);

    doc.setTextColor(140, 140, 140);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('• All transactions are final and non-refundable unless stated otherwise.', 15, notesY + 15);
    doc.text('• This invoice is system-generated and valid without a signature.', 15, notesY + 21);
    doc.text('• For disputes, contact support within 7 days of the transaction date.', 15, notesY + 27);

    // ─────────────────────────────────────────────
    // "PAID" DIAGONAL WATERMARK (if completed)
    // ─────────────────────────────────────────────
    if ((transaction.status || 'completed') === 'completed') {
      doc.saveGraphicsState();
      doc.setTextColor(34, 197, 94);
      doc.setFontSize(55);
      doc.setFont('helvetica', 'bold');
      doc.setGState(doc.GState({ opacity: 0.07 }));
      doc.text('PAID', pageWidth / 2, pageHeight / 2 + 20, {
        align: 'center',
        angle: 35,
      });
      doc.restoreGraphicsState();
    }

    // ─────────────────────────────────────────────
    // ORANGE HORIZONTAL LINE BEFORE FOOTER
    // ─────────────────────────────────────────────
    doc.setFillColor(249, 115, 22);
    doc.rect(0, pageHeight - 20, pageWidth, 2.5, 'F');

    // Thin dark strip at very bottom
    doc.setFillColor(20, 20, 20);
    doc.rect(0, pageHeight - 17.5, pageWidth, 17.5, 'F');

    // ─────────────────────────────────────────────
    // FOOTER
    // ─────────────────────────────────────────────
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text(
      'This invoice is generated by the WCM Payment System  |  World Culture Market Place  |  All rights reserved.',
      pageWidth / 2,
      pageHeight - 9,
      { align: 'center' }
    );
    doc.setTextColor(249, 115, 22);
    doc.text(
      process.env.BUSINESS_WEBSITE || 'www.worldculturemarketplace.com',
      pageWidth / 2,
      pageHeight - 4,
      { align: 'center' }
    );

    // ─────────────────────────────────────────────
    // OUTPUT
    // ─────────────────────────────────────────────
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