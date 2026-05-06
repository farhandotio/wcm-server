import mongoose from 'mongoose';

const stepSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true }
});

const howItWorkSchema = new mongoose.Schema({
    pageName: {
        type: String,
        default: "how-it-works",
        unique: true
    },
    headerTitle: {
        type: String,
        default: "Empowering Global Craftsmanship" // সরাসরি ডিফল্ট ভ্যালু
    },
    headerDescription: {
        type: String,
        default: "World Cultural Marketplace (WCM) brings the world's finest artisans under one roof."
    },
    steps: {
        type: [stepSchema],
        default: [
            { id: 1, title: "Create Your Profile", description: "Sign up as a creator..." },
            { id: 2, title: "Upload Listings", description: "Add your creations..." },
            { id: 3, title: "Review & Approval", description: "Our team reviews..." },
            { id: 4, title: "Get Discovered", description: "Your listings appear..." }
        ]
    }
}, { timestamps: true });

export default mongoose.model('HowItWork', howItWorkSchema);