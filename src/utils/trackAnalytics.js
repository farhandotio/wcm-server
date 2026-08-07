import Analytics from '../models/Analytics.js';
import { getReportingDateBucket } from './reportingTime.js';

export const trackActivity = async (listingId, creatorId, type = 'view', occurredAt = new Date()) => {
  try {
    const today = getReportingDateBucket(occurredAt);

    const update = type === 'view' ? { $inc: { views: 1 } } : { $inc: { clicks: 1 } };

    await Analytics.findOneAndUpdate({ listingId, creatorId, date: today }, update, {
      upsert: true,
      new: true,
    });
  } catch (err) {
    console.error('Analytics Error:', err);
  }
};
