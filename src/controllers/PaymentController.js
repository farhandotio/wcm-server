import mongoose from 'mongoose';
import Stripe from 'stripe';
import axios from 'axios';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Real-time Exchange Rate Helper ---
const getExchangeRate = async (fromCurrency, toCurrency) => {
  try {
    const from = fromCurrency.toLowerCase();
    const to = toCurrency.toLowerCase();
    if (from === to) return 1;

    const response = await axios.get(
      `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/${from}/${to}`
    );

    if (response.data && response.data.conversion_rate) {
      return response.data.conversion_rate;
    }
    return 1;
  } catch (error) {
    console.error('Exchange Rate Error:', error.message);
    return 1;
  }
};

// --- Create Checkout Session ---
export const createCheckoutSession = async (req, res) => {
  try {
    const { listingId, packageType, amount, currency, currentPath, days, totalClicks } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const now = new Date();

    // --- প্রি-পেমেন্ট ভ্যালিডেশন (ডুপ্লিকেট প্রোমোশন চেক) ---
    if (packageType === 'boost') {
      // যদি অলরেডি একটিভ বুস্ট থাকে যার মেয়াদ শেষ হয়নি
      if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
        return res.status(400).json({
          message: 'You already have an active Viral Boost for this listing.',
        });
      }
    } else if (packageType === 'ppc') {
      // যদি পিপিছি ব্যালেন্স এখনো থাকে
      if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
        return res.status(400).json({
          message: 'You already have an active PPC balance. Please wait for it to finish.',
        });
      }
    }

    const paymentCurrency = currency || 'eur';

    // CPC ক্যালকুলেশন (এটি মেটাডাটায় যাবে)
    const calculatedCPC =
      packageType === 'ppc' ? (Number(amount) / Number(totalClicks)).toFixed(4) : '0';

    // স্ট্রাইপ সেশন তৈরি
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: paymentCurrency,
            product_data: {
              name: `${packageType.toUpperCase()} Promotion: ${listing.title}`,
              description:
                packageType === 'boost'
                  ? `${days} Days Viral Boost`
                  : `${totalClicks} Clicks Credit`,
            },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}${currentPath || '/'}?success=true`,
      cancel_url: `${process.env.CLIENT_URL}${currentPath || '/'}?canceled=true`,
      metadata: {
        listingId,
        packageType,
        days: days ? days.toString() : '0',
        totalClicks: totalClicks ? totalClicks.toString() : '0',
        originalCpc: calculatedCPC,
        creatorId: req.user._id.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe Session Error:', error);
    res.status(500).json({ message: 'Could not initiate payment. Please try again.' });
  }
};

const applyPromotionLogic = (listing, daysInput = null) => {
  let boostScore = 0;
  let ppcScore = 0;
  const now = new Date();

  // ১. Boost Intensity (টাকা / দিন)
  if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
    const amount = listing.promotion.boost.amountPaid || 0;
    const expiry = new Date(listing.promotion.boost.expiresAt);

    let daysDiff = daysInput;
    if (!daysDiff) {
      const diffTime = Math.abs(expiry - now);
      daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    }

    boostScore = (amount / daysDiff) * 10;
  }

  // ২. PPC Priority (High CPC = High Level)
  if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
    const cpc = listing.promotion.ppc.costPerClick || 0.1;
    const balance = listing.promotion.ppc.ppcBalance || 0;

    // CPC কে ৩০০ গুণ গুরুত্ব দেওয়া হয়েছে
    ppcScore = cpc * 300 + balance * 0.05;
  }

  // ৩. আপডেট
  listing.promotion.level = Math.floor(boostScore + ppcScore);
  listing.isPromoted = !!(
    (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) ||
    (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now)
  );

  if (!listing.isPromoted) listing.promotion.level = 0;

  return listing;
};

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { listingId, packageType, creatorId, days, totalClicks, originalCpc } = session.metadata;

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
      const listing = await Listing.findById(listingId).session(dbSession);
      if (!listing) throw new Error('Listing not found');

      const now = new Date();

      // --- ডুপ্লিকেট প্রমোশন চেক ---
      if (packageType === 'boost') {
        if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
          throw new Error('Listing already has an active boost.');
        }
      } else if (packageType === 'ppc') {
        if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
          throw new Error('Listing already has an active PPC campaign.');
        }
      }

      // --- পেমেন্ট ডাটা প্রসেসিং ---
      const amountPaid = session.amount_total / 100;
      const paymentCurrency = session.currency.toUpperCase();
      const targetCurrency = 'EUR';

      const fxRate = await getExchangeRate(paymentCurrency, targetCurrency);
      const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

      const vatRate = 19;
      const vatAmountInEUR = Number((amountInEUR - amountInEUR / (1 + vatRate / 100)).toFixed(2));

      // ট্রানজেকশন রেকর্ড
      await Transaction.create(
        [
          {
            creator: creatorId,
            listing: listingId,
            stripeSessionId: session.id,
            amountPaid,
            currency: session.currency,
            fxRate,
            amountInEUR,
            packageType,
            status: 'completed',
            invoiceNumber: `INV-${Date.now()}`,
            vatAmount: vatAmountInEUR,
          },
        ],
        { session: dbSession }
      );

      // --- ডাটা আপডেট ---
      if (packageType === 'boost') {
        listing.promotion.boost.isActive = true;
        listing.promotion.boost.amountPaid = amountInEUR;
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + parseInt(days));
        listing.promotion.boost.expiresAt = expiry;
      } else if (packageType === 'ppc') {
        listing.promotion.ppc.isActive = true;
        listing.promotion.ppc.ppcBalance = amountInEUR;
        listing.promotion.ppc.amountPaid = amountInEUR;
        listing.promotion.ppc.totalClicks = parseInt(totalClicks);
        listing.promotion.ppc.executedClicks = 0; // রিসেট

        const cpcInEUR = Number((Number(originalCpc) * fxRate).toFixed(4));
        listing.promotion.ppc.costPerClick = cpcInEUR;
      }

      // র‍্যাঙ্কিং লজিক কল (পাসিং days ইনপুট)
      applyPromotionLogic(listing, parseInt(days) || null);

      await listing.save({ session: dbSession });
      await dbSession.commitTransaction();

      console.log(`[Webhook] Success. Listing: ${listingId}, Level: ${listing.promotion.level}`);
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('❌ Webhook Logic Error:', error.message);
      // এখানে আপনি চাইলে ইউজারকে রিফান্ড বা এরর লগ দিতে পারেন
    } finally {
      dbSession.endSession();
    }
  }
  res.json({ received: true });
};

// --- Generate Invoice ---
export const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await Transaction.findById(id).populate('creator').populate('listing');
    if (!transaction) return res.status(404).send('Invoice not found');

    const doc = new jsPDF();
    const vatRate = parseFloat(process.env.DEFAULT_VAT_RATE) || 19;

    // পেমেন্ট করা অরিজিনাল কারেন্সিতে ভ্যাট হিসাব
    const netAmount = transaction.amountPaid / (1 + vatRate / 100);
    const vatValue = transaction.amountPaid - netAmount;

    // Header Design
    doc.setFillColor(249, 115, 22);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('OFFICIAL INVOICE', 15, 25);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Invoice: ${transaction.invoiceNumber}`, 15, 50);
    doc.text(`Date: ${new Date(transaction.createdAt).toLocaleDateString()}`, 15, 55);

    doc.setFont('helvetica', 'bold');
    doc.text('Bill To:', 140, 50);
    doc.setFont('helvetica', 'normal');
    doc.text(`${transaction.creator.firstName} ${transaction.creator.lastName}`, 140, 55);
    doc.text(transaction.creator.email, 140, 60);

    autoTable(doc, {
      startY: 70,
      head: [['Service', 'Net', 'VAT', 'Total']],
      body: [
        [
          `${transaction.packageType.toUpperCase()} - ${transaction.listing.title}`,
          `${transaction.currency.toUpperCase()} ${netAmount.toFixed(2)}`,
          `${vatRate}%`,
          `${transaction.currency.toUpperCase()} ${transaction.amountPaid.toFixed(2)}`,
        ],
      ],
      headStyles: { fillColor: [249, 115, 22] },
    });

    const pdfBuffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    res.status(500).send('Error generating PDF');
  }
};
