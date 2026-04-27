// utils/logger.js
import AuditLog from '../models/AuditLog.js';

export const createAuditLog = async ({ req, user, action, targetType, targetId, details }) => {
  try {
    // ১. ইউজার আইডি ডিটেকশন (Prioritize passed user, then req.user)
    const userId = user || (req?.user ? req.user._id : null);

    if (!userId) {
      console.warn(`[AuditLog Warning] Action "${action}" recorded without a specific User ID.`);
    }

    // ২. আইপি অ্যাড্রেস ডিটেকশন (Stripe বা Proxy এর ক্ষেত্রে নিরাপদ রাখা)
    const ip =
      req?.headers?.['x-forwarded-for']?.split(',')[0] ||
      req?.ip ||
      req?.connection?.remoteAddress ||
      'system_action';

    await AuditLog.create({
      user: userId,
      action,
      targetType,
      targetId,
      details,
      ipAddress: ip,
    });
  } catch (error) {
    // ৩. মেইন প্রসেস যেন এর কারণে বন্ধ না হয়
    console.error('CRITICAL: Audit Log Failed to Save:', error.message);
  }
};
