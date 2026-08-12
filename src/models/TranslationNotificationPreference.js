import mongoose from 'mongoose';
import { TRANSLATION_NOTIFICATION_EVENTS } from './TranslationNotification.js';

const DEFAULT_TRANSLATION_NOTIFICATION_EVENTS = ['available', 'failed', 'updated', 'requires_attention'];

const translationNotificationPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    enabled: { type: Boolean, default: true },
    enabledEvents: {
      type: [{ type: String, enum: TRANSLATION_NOTIFICATION_EVENTS }],
      default: () => [...DEFAULT_TRANSLATION_NOTIFICATION_EVENTS],
    },
  },
  { timestamps: true }
);

export default mongoose.models.TranslationNotificationPreference ||
  mongoose.model('TranslationNotificationPreference', translationNotificationPreferenceSchema);
