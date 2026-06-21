import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    rawHtml: {
        type: String,
        required: [true, 'HTML/Script code is required'],
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

export default mongoose.model('Verification', verificationSchema);