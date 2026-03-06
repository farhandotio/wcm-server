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

// --- Ranking & Promotion Logic ---
const applyPromotionLogic = (listing) => {
  let boostScore = 0;
  let ppcScore = 0;
  const now = new Date();

  // ১. Viral Boost Calculation (Based on EUR value)
  if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now) {
    const amount = listing.promotion.boost.amountPaid || 0;
    const expiry = new Date(listing.promotion.boost.expiresAt);
    const diffTime = Math.abs(expiry - now);
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    boostScore = (amount / daysLeft) * 10;
  }

  // ২. PPC Logic (Based on converted CPC)
  if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
    const cpc = listing.promotion.ppc.costPerClick || 0.1;
    ppcScore = cpc * 150;
  }

  // ৩. Engagement Score
  const engagementScore = (listing.views || 0) * 0.05 + (listing.favorites?.length || 0) * 1;

  listing.promotion.level = Math.floor(boostScore + ppcScore + engagementScore);

  const hasActivePpc = listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0;
  const hasActiveBoost =
    listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > now;
  listing.isPromoted = !!(hasActivePpc || hasActiveBoost);

  return listing;
};

// --- Create Checkout Session ---
export const createCheckoutSession = async (req, res) => {
  try {
    const { listingId, packageType, amount, currency, currentPath, days, totalClicks } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    const paymentCurrency = currency || 'eur';
    const calculatedCPC =
      packageType === 'ppc' ? (Number(amount) / Number(totalClicks)).toFixed(4) : 0;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: paymentCurrency,
            product_data: {
              name: `${packageType.toUpperCase()} Promotion: ${listing.title}`,
              description:
                packageType === 'boost' ? `${days} Days Boost` : `${totalClicks} Clicks Credit`,
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
        originalCpc: calculatedCPC.toString(),
        creatorId: req.user._id.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe Session Error:', error);
    res.status(500).json({ message: 'Payment failed' });
  }
};

// --- Webhook Handler (The Core Logic) ---
// export const handleStripeWebhook = async (req, res) => {
//   const sig = req.headers['stripe-signature'];
//   let event;

//   try {
//     event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
//   } catch (err) {
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }

//   if (event.type === 'checkout.session.completed') {
//     const session = event.data.object;
//     const { listingId, packageType, creatorId, days, totalClicks, originalCpc } = session.metadata;

//     const dbSession = await mongoose.startSession();
//     dbSession.startTransaction();

//     try {
//       const amountPaid = session.amount_total / 100;
//       const paymentCurrency = session.currency.toUpperCase();
//       const targetCurrency = process.env.INTERNAL_CURRENCY || 'EUR';

//       // ১. রিয়েল-টাইম এক্সচেঞ্জ রেট আনা
//       const fxRate = await getExchangeRate(paymentCurrency, targetCurrency);
//       const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

//       // ২. ভ্যাট ক্যালকুলেশন (শুধুমাত্র হিসাবের জন্য, টোটাল অ্যামাউন্ট থেকে আলাদা করা)
//       const vatRate = parseFloat(process.env.DEFAULT_VAT_RATE) || 19;
//       const vatAmountInEUR = Number((amountInEUR - amountInEUR / (1 + vatRate / 100)).toFixed(2));

//       // ৩. ট্রানজেকশন রেকর্ড
//       await Transaction.create(
//         [
//           {
//             creator: creatorId,
//             listing: listingId,
//             stripeSessionId: session.id,
//             amountPaid,
//             currency: session.currency,
//             fxRate,
//             amountInEUR,
//             packageType,
//             status: 'completed',
//             invoiceNumber: `INV-${Date.now()}`,
//             vatAmount: vatAmountInEUR,
//           },
//         ],
//         { session: dbSession }
//       );

//       // ৪. লিস্টিং আপডেট
//       const listing = await Listing.findById(listingId).session(dbSession);
//       if (!listing) throw new Error('Listing not found');

//       if (packageType === 'boost') {
//         listing.promotion.boost.isActive = true;
//         listing.promotion.boost.amountPaid = amountInEUR;
//         const expiry = new Date();
//         expiry.setDate(expiry.getDate() + parseInt(days));
//         listing.promotion.boost.expiresAt = expiry;
//       } else if (packageType === 'ppc') {
//         listing.promotion.ppc.isActive = true;
//         listing.promotion.ppc.ppcBalance = Number(
//           ((listing.promotion.ppc.ppcBalance || 0) + amountInEUR).toFixed(2)
//         );
//         listing.promotion.ppc.amountPaid = Number(
//           ((listing.promotion.ppc.amountPaid || 0) + amountInEUR).toFixed(2)
//         );
//         listing.promotion.ppc.totalClicks =
//           (listing.promotion.ppc.totalClicks || 0) + parseInt(totalClicks);

//         // CPC-কেও EUR-তে কনভার্ট করা হলো
//         const cpcInEUR = Number((Number(originalCpc) * fxRate).toFixed(4));
//         listing.promotion.ppc.costPerClick = cpcInEUR;
//       }

//       applyPromotionLogic(listing);
//       await listing.save({ session: dbSession });

//       await dbSession.commitTransaction();
//       console.log(`Success: Converted ${amountPaid} ${paymentCurrency} to ${amountInEUR} EUR`);
//     } catch (error) {
//       await dbSession.abortTransaction();
//       console.error('Webhook Error:', error);
//     } finally {
//       dbSession.endSession();
//     }
//   }
//   res.json({ received: true });
// };

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
      const amountPaid = session.amount_total / 100;
      const paymentCurrency = session.currency.toUpperCase();
      const targetCurrency = 'EUR';

      // ১. কারেন্সি কনভার্সন
      const fxRate = await getExchangeRate(paymentCurrency, targetCurrency);
      const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

      // ২. ট্রানজেকশন রেকর্ড (ভ্যাট সহ)
      const vatRate = 19;
      const vatAmountInEUR = Number((amountInEUR - amountInEUR / (1 + vatRate / 100)).toFixed(2));

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

      // ৩. লিস্টিং আপডেট ও লেভেল ক্যালকুলেশন
      const listing = await Listing.findById(listingId).session(dbSession);
      if (!listing) throw new Error('Listing not found');

      if (packageType === 'boost') {
        listing.promotion.boost.isActive = true;
        listing.promotion.boost.amountPaid = amountInEUR;
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + parseInt(days));
        listing.promotion.boost.expiresAt = expiry;
      } else if (packageType === 'ppc') {
        listing.promotion.ppc.isActive = true;
        listing.promotion.ppc.ppcBalance = Number(
          ((listing.promotion.ppc.ppcBalance || 0) + amountInEUR).toFixed(2)
        );
        listing.promotion.ppc.amountPaid = Number(
          ((listing.promotion.ppc.amountPaid || 0) + amountInEUR).toFixed(2)
        );
        listing.promotion.ppc.totalClicks =
          (listing.promotion.ppc.totalClicks || 0) + parseInt(totalClicks);

        // CPC EUR-তে কনভার্ট করা হলো
        const cpcInEUR = Number((Number(originalCpc) * fxRate).toFixed(4));
        listing.promotion.ppc.costPerClick = cpcInEUR;
      }

      // ৪. নতুন র‍্যাঙ্কিং অ্যালগরিদম (Views/Favs বাদ দেওয়া হয়েছে)
      // Boost Intensity = (টাকা / দিন) * ২
      const boostIntensity = listing.promotion.boost.isActive
        ? (listing.promotion.boost.amountPaid / parseInt(days || 1)) * 2
        : 0;

      // PPC Priority = (CPC * ১০) + (টোটাল বাজেট / ১০)
      const ppcPriority = listing.promotion.ppc.isActive
        ? listing.promotion.ppc.costPerClick * 10 + listing.promotion.ppc.ppcBalance / 10
        : 0;

      // ফাইনাল লেভেল সেট (সাথে সাথে রিফ্রেশ)
      listing.promotion.level = Math.floor(boostIntensity + ppcPriority);
      listing.isPromoted = true;

      await listing.save({ session: dbSession });
      await dbSession.commitTransaction();

      console.log(`[Webhook] Success. New Level: ${listing.promotion.level}`);
    } catch (error) {
      await dbSession.abortTransaction();
      console.error('Webhook Error:', error);
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
