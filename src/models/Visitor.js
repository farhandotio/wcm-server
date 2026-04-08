import mongoose from 'mongoose';

const visitorSchema = new mongoose.Schema(
  {
    visitorId: { type: String, unique: true, required: true },
    ip: String,
    device: String,
    os: String,
    country: { type: String, default: 'Unknown' },
    city: { type: String, default: 'Unknown' }, 
    visitCount: { type: Number, default: 1 },
    lastVisited: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Visitor = mongoose.model('Visitor', visitorSchema);
export default Visitor;
