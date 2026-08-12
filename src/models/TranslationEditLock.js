import mongoose from 'mongoose';

const translationEditLockSchema = new mongoose.Schema(
  {
    translationRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TranslationRecord',
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lockToken: { type: String, required: true, trim: true },
    lockedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

translationEditLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.TranslationEditLock ||
  mongoose.model('TranslationEditLock', translationEditLockSchema);
