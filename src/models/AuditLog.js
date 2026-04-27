import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  action: {
    type: String,
    required: true, // e.g., 'PAYMENT_COMPLETED', 'PPC_BUDGET_RELOAD', 'BOOST_ACTIVATED'
    index: true,
  },
  targetType: {
    type: String,
    enum: ['Listing', 'User', 'Transaction'],
    required: true,
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'targetType',
  },
  details: {
    type: Object, // এখানে পুরো JSON ডাটা থাকবে (যেমন: amount, package name, listing title)
    required: true,
  },
  ipAddress: String,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

export default mongoose.model('AuditLog', auditLogSchema);
