import mongoose from 'mongoose';

export const FAQ_CATEGORIES = {
    GENERAL: 'General',
    ARTISTS: 'Artists', 
    VISITORS: 'Visitors', 
    PLATFORM: 'Platform',
    TECHNICAL: 'Technical'
};

const faqSchema = new mongoose.Schema(
    {
        question: {
            type: String,
            required: [true, 'Question is required'],
            trim: true,
            minlength: [10, 'Question must be at least 10 characters long'],
            maxlength: [500, 'Question cannot exceed 500 characters']
        },
        answer: {
            type: String,
            required: [true, 'Answer is required'],
            trim: true
        },
        category: {
            type: String,
            required: [true, 'Category is required'],
            enum: {
                values: Object.values(FAQ_CATEGORIES),
                message: '{VALUE} is not a valid category'
            },
            default: FAQ_CATEGORIES.GENERAL
        },
        isActive: {
            type: Boolean,
            default: true 
        }
    },
    {
        timestamps: true
    }
);

faqSchema.index({ category: 1, createdAt: -1 });

const Faq = mongoose.models.Faq || mongoose.model('Faq', faqSchema);

export default Faq;