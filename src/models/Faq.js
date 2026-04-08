import mongoose from 'mongoose';

const faqSchema = new mongoose.Schema(
    {
        question: {
            type: String,
            required: [true, 'Question is required'],
            trim: true
        },
        answer: {
            type: String,
            required: [true, 'Answer is required']
        },
        category: {
            type: String,
            required: [true, 'Category is required'],
            enum: ['General', 'Artists', 'Creators', 'Platform', 'Technical'],
        },
    },
    { timestamps: true }
);

// ক্যাটাগরি অনুযায়ী দ্রুত ডেটা খোঁজার জন্য ইনডেক্সিং
faqSchema.index({ category: 1 });

const Faq = mongoose.models.Faq || mongoose.model('Faq', faqSchema);
export default Faq;