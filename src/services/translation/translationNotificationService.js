import TranslationNotification, {
  TRANSLATION_NOTIFICATION_EVENTS,
} from '../../models/TranslationNotification.js';
import TranslationNotificationPreference from '../../models/TranslationNotificationPreference.js';

export const TRANSLATION_NOTIFICATION_DEDUPE_MS = 5 * 60 * 1000;

export const createTranslationNotificationDedupeKey = ({
  recipient,
  businessObjectType,
  businessObjectId,
  languageCode,
  eventType,
  now = new Date(),
}) => {
  const bucket = Math.floor(now.getTime() / TRANSLATION_NOTIFICATION_DEDUPE_MS);
  return [recipient, businessObjectType, businessObjectId, languageCode, eventType, bucket].join(':');
};

export const queueTranslationNotification = async (
  {
    recipient,
    eventType,
    businessObjectType,
    businessObjectId,
    languageCode,
    translationRecordId = null,
    payload = {},
    now = new Date(),
  },
  { session = null } = {}
) => {
  if (!TRANSLATION_NOTIFICATION_EVENTS.includes(eventType)) {
    throw new Error(`Unsupported translation notification event: ${eventType}`);
  }

  const preference = await TranslationNotificationPreference.findOne({ user: recipient })
    .session(session)
    .lean();
  if (preference && (!preference.enabled || !preference.enabledEvents.includes(eventType))) {
    return null;
  }

  const dedupeKey = createTranslationNotificationDedupeKey({
    recipient,
    businessObjectType,
    businessObjectId,
    languageCode,
    eventType,
    now,
  });

  return TranslationNotification.findOneAndUpdate(
    { dedupeKey },
    {
      $setOnInsert: {
        recipient,
        eventType,
        businessObjectType,
        businessObjectId,
        languageCode,
        translationRecordId,
        dedupeKey,
        payload,
        expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      },
    },
    { returnDocument: 'after', upsert: true, runValidators: true, session }
  );
};

export const listTranslationNotifications = ({ recipient, unreadOnly = false }) =>
  TranslationNotification.find({
    recipient,
    ...(unreadOnly ? { isRead: false } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();

export const markTranslationNotificationRead = (notificationId, recipient) =>
  TranslationNotification.findOneAndUpdate(
    { _id: notificationId, recipient },
    { $set: { isRead: true, readAt: new Date() } },
    { returnDocument: 'after' }
  );

export const updateTranslationNotificationPreferences = (
  user,
  { enabled, enabledEvents }
) =>
  TranslationNotificationPreference.findOneAndUpdate(
    { user },
    {
      $set: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(enabledEvents !== undefined ? { enabledEvents } : {}),
      },
      $setOnInsert: { user },
    },
    { returnDocument: 'after', upsert: true, runValidators: true }
  );

export const markNotificationOutboxProcessed = (notificationId, succeeded = true) =>
  TranslationNotification.findByIdAndUpdate(
    notificationId,
    {
      $set: {
        outboxStatus: succeeded ? 'processed' : 'failed',
        outboxProcessedAt: new Date(),
      },
      $inc: { outboxAttempts: 1 },
    },
    { returnDocument: 'after' }
  );
