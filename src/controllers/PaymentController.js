import mongoose from 'mongoose';
import Stripe from 'stripe';
import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import User from '../models/User.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Ranking & Promotion Logic (Improved for Intensity) ---
const applyPromotionLogic = (listing) => {
  let boostScore = 0;
  let ppcScore = 0;

  if (listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > new Date()) {
    const amount = listing.promotion.boost.amountPaid || 0;
    const now = new Date();
    const expiry = new Date(listing.promotion.boost.expiresAt);
    const diffTime = Math.abs(expiry - now);
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

    boostScore = (amount / daysLeft) * 10;
  }

  if (listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0) {
    const cpc = listing.promotion.ppc.costPerClick || 0.1;

    ppcScore = cpc * 150;
  }

  // ৩. Organic Engagement
  const engagementScore = (listing.views || 0) * 0.05 + (listing.favorites?.length || 0) * 1;

  listing.promotion.level = Math.floor(boostScore + ppcScore + engagementScore);

  const hasActivePpc = listing.promotion.ppc.isActive && listing.promotion.ppc.ppcBalance > 0;
  const hasActiveBoost =
    listing.promotion.boost.isActive && listing.promotion.boost.expiresAt > new Date();
  listing.isPromoted = !!(hasActivePpc || hasActiveBoost);

  return listing;
};

// --- Stripe Checkout ---
export const createCheckoutSession = async (req, res) => {
  try {
    const { listingId, packageType, amount, currency, currentPath, days, totalClicks } = req.body;
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (
      packageType === 'boost' &&
      listing.promotion.boost.isActive &&
      listing.promotion.boost.expiresAt > new Date()
    ) {
      return res.status(400).json({ message: 'This listing already has an active Viral Boost.' });
    }

    const calculatedCPC =
      packageType === 'ppc' ? (Number(amount) / Number(totalClicks)).toFixed(2) : 0;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency || 'eur',
            product_data: {
              name: `${packageType.toUpperCase()} Promotion: ${listing.title}`,
              description:
                packageType === 'boost'
                  ? `Active for ${days} days`
                  : `Credit for ${totalClicks} clicks`,
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
        costPerClick: calculatedCPC.toString(),
        creatorId: req.user._id.toString(),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: 'Payment initialization failed.' });
  }
};

// --- Webhook with Retry Logic for WriteConflict ---
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
    const { listingId, packageType, creatorId, days, totalClicks } = session.metadata;

    // Retry Logic for MongoDB Transactions
    let retries = 3;
    while (retries > 0) {
      const dbSession = await mongoose.startSession();
      dbSession.startTransaction();
      try {
        const amountPaid = session.amount_total / 100;
        const fxRate = session.currency === 'usd' ? 0.92 : 1;
        const amountInEUR = Number((amountPaid * fxRate).toFixed(2));

        // ১. ট্রানজেকশন রেকর্ড
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
            },
          ],
          { session: dbSession }
        );

        // ২. লিস্টিং আপডেট
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
          listing.promotion.ppc.amountPaid = (listing.promotion.ppc.amountPaid || 0) + amountInEUR;

          // এখানে CPC ক্যালকুলেট হচ্ছে (বেশি টাকা / কম ক্লিক = High CPC)
          const newCPC = Number((amountInEUR / parseInt(totalClicks)).toFixed(2));
          listing.promotion.ppc.costPerClick = newCPC;
          listing.promotion.ppc.totalClicks =
            (listing.promotion.ppc.totalClicks || 0) + parseInt(totalClicks);
        }

        // ৩. ইনটেনসিটি লজিক অ্যাপ্লাই
        applyPromotionLogic(listing);

        await listing.save({ session: dbSession });
        await dbSession.commitTransaction();
        break; // সফল হলে লুপ থেকে বের হয়ে যাবে
      } catch (error) {
        await dbSession.abortTransaction();
        retries--;
        if (error.code === 112 && retries > 0) {
          console.log(`WriteConflict detected. Retrying... (${retries} left)`);
          await new Promise((res) => setTimeout(res, 500)); // ০.৫ সেকেন্ড ওয়েট
        } else {
          console.error('Webhook Final Error:', error);
          break;
        }
      } finally {
        dbSession.endSession();
      }
    }
  }
  res.json({ received: true });
};

// --- Wallet Payment (Fixed fxRate Bug) ---
export const payWithWallet = async (req, res) => {
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();
  try {
    const { listingId, packageType, amount, days, totalClicks } = req.body;
    const userId = req.user._id;

    const listing = await Listing.findById(listingId).session(dbSession);
    if (
      packageType === 'boost' &&
      listing.promotion.boost.isActive &&
      listing.promotion.boost.expiresAt > new Date()
    ) {
      throw new Error('Listing already has an active Viral Boost.');
    }

    const user = await User.findById(userId).session(dbSession);
    if (!user || user.walletBalance < amount) throw new Error('Insufficient wallet balance.');

    user.walletBalance = Number((user.walletBalance - amount).toFixed(2));
    await user.save({ session: dbSession });

    const amountNum = Number(amount);

    await Transaction.create(
      [
        {
          creator: userId,
          listing: listingId,
          stripeSessionId: `WALLET-${Date.now()}`,
          amountPaid: amountNum,
          currency: 'eur',
          fxRate: 1, // 🔹 Wallet is 1:1 EUR
          amountInEUR: amountNum,
          packageType,
          status: 'completed',
          invoiceNumber: `INV-W-${Date.now()}`,
        },
      ],
      { session: dbSession }
    );

    if (packageType === 'boost') {
      listing.promotion.boost.isActive = true;
      listing.promotion.boost.amountPaid = amountNum;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + parseInt(days));
      listing.promotion.boost.expiresAt = expiry;
    } else {
      listing.promotion.ppc.isActive = true;
      listing.promotion.ppc.ppcBalance = Number(
        ((listing.promotion.ppc.ppcBalance || 0) + amountNum).toFixed(2)
      );
      listing.promotion.ppc.amountPaid = (listing.promotion.ppc.amountPaid || 0) + amountNum;
      listing.promotion.ppc.costPerClick = Number((amountNum / parseInt(totalClicks)).toFixed(2));
      listing.promotion.ppc.totalClicks =
        (listing.promotion.ppc.totalClicks || 0) + parseInt(totalClicks);
    }

    applyPromotionLogic(listing);
    await listing.save({ session: dbSession });
    await dbSession.commitTransaction();
    res.status(200).json({ success: true, message: 'Promotion activated!' });
  } catch (error) {
    await dbSession.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    dbSession.endSession();
  }
};

export const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const BUSINESS_NAME = process.env.BUSINESS_NAME || 'World Culture Marketplace';
    const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || '123 Culture Street, Berlin, Germany';
    const BUSINESS_VAT_NUMBER = process.env.BUSINESS_VAT_NUMBER || 'DE123456789';
    const DEFAULT_VAT_RATE = process.env.DEFAULT_VAT_RATE || 19;

    const transaction = await Transaction.findById(id)
      .populate('creator', 'firstName lastName email')
      .populate('listing', 'title');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction record not found' });
    }

    const doc = new jsPDF();
    const brandOrange = [249, 115, 22];

    // --- Header ---
    doc.setFillColor(...brandOrange);
    doc.rect(0, 0, 210, 40, 'F');

    doc.setFontSize(24);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', 14, 25);

    // --- Meta Info ---
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const invNo =
      transaction.invoiceNumber || `INV-${transaction._id.toString().slice(-6).toUpperCase()}`;
    doc.text(`Invoice Number: ${invNo}`, 145, 18);
    doc.text(`Date Issued: ${new Date(transaction.createdAt).toLocaleDateString()}`, 145, 24);
    doc.text(`Payment Status: PAID`, 145, 30);

    // --- Business & Client Details ---
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);

    // Company Side
    doc.setFont('helvetica', 'bold');
    doc.text('FROM:', 14, 50);
    doc.setFont('helvetica', 'normal');
    doc.text(BUSINESS_NAME, 14, 56);
    doc.text(BUSINESS_ADDRESS, 14, 62);
    doc.text(`VAT: ${BUSINESS_VAT_NUMBER}`, 14, 68);

    // Client Side
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO:', 120, 50);
    doc.setFont('helvetica', 'normal');
    doc.text(`${transaction.creator?.firstName} ${transaction.creator?.lastName}`, 120, 56);
    doc.text(transaction.creator?.email || 'N/A', 120, 62);

    // --- Calculations ---
    const totalAmount = transaction.amountPaid || 0;
    const netAmount = totalAmount / (1 + DEFAULT_VAT_RATE / 100);
    const vatAmount = totalAmount - netAmount;

    // --- Items Table ---
    autoTable(doc, {
      startY: 80,
      head: [['Service Description', 'Type', 'Net Amount', 'VAT', 'Total']],
      body: [
        [
          `Promotion: ${transaction.listing?.title || 'Culture Asset'}`,
          transaction.packageType.toUpperCase(),
          `${transaction.currency.toUpperCase()} ${netAmount.toFixed(2)}`,
          `${DEFAULT_VAT_RATE}%`,
          `${transaction.currency.toUpperCase()} ${totalAmount.toFixed(2)}`,
        ],
      ],
      headStyles: {
        fillColor: brandOrange,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        4: { halign: 'right', fontStyle: 'bold' },
      },
    });

    // --- Totals Summary ---
    const finalY = doc.lastAutoTable.finalY + 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Subtotal (Net):', 140, finalY);
    doc.text(`${transaction.currency.toUpperCase()} ${netAmount.toFixed(2)}`, 196, finalY, {
      align: 'right',
    });

    doc.text(`VAT (${DEFAULT_VAT_RATE}%):`, 140, finalY + 6);
    doc.text(`${transaction.currency.toUpperCase()} ${vatAmount.toFixed(2)}`, 196, finalY + 6, {
      align: 'right',
    });

    doc.setLineWidth(0.5);
    doc.line(140, finalY + 10, 196, finalY + 10);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Total Paid:', 140, finalY + 18);
    doc.text(`${transaction.currency.toUpperCase()} ${totalAmount.toFixed(2)}`, 196, finalY + 18, {
      align: 'right',
    });

    // --- Footer ---
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(150, 150, 150);
    doc.text(
      'This is a computer-generated document. No signature is required.',
      105,
      pageHeight - 20,
      { align: 'center' }
    );
    doc.text('Thank you for choosing World Culture Marketplace!', 105, pageHeight - 15, {
      align: 'center',
    });

    // --- Finalize and Send ---
    const pdfBuffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Invoice-${invNo}.pdf`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Invoice Generation Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice',
      error: error.message,
    });
  }
};
