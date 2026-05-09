import mongoose from 'mongoose';

const subscriptionEmailSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export const SubscriptionEmails = mongoose.model('SubscriptionEmails', subscriptionEmailSchema);