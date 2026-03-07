import mongoose from 'mongoose';

const interactionLogSchema = new mongoose.Schema({
  listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deviceId: { type: String, required: true },
  type: { type: String, enum: ['view', 'ppc_click'], required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});

interactionLogSchema.index({ listingId: 1, deviceId: 1, type: 1 });
interactionLogSchema.index({ listingId: 1, userId: 1, type: 1 });

const InteractionLog = mongoose.model('InteractionLog', interactionLogSchema);
export default InteractionLog;
