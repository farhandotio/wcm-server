import mongoose from 'mongoose';

const stepSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true
    },
    title: {
        type: String,
        required: true,
        default: ''
    },
    description: {
        type: String,
        required: true,
        default: ''
    }
}, { _id: false });

const howItWorkSchema = new mongoose.Schema({
    pageName: {
        type: String,
        default: "how-it-works",
        unique: true
    },
    headerTitle: {
        type: String,
        default: "Empowering Global Craftsmanship"
    },
    headerDescription: {
        type: String,
        default: "World Cultural Marketplace (WCM) brings the world's finest artisans under one roof."
    },
    steps: {
        type: [stepSchema],
        default: [
            { id: 1, title: "Create Your Profile", description: "Sign up as a creator and tell the world about your craft, culture, and story." },
            { id: 2, title: "Upload Listings", description: "Add your creations with photos, descriptions, and cultural tags that connect visitors to your traditions." },
            { id: 3, title: "Review & Approval", description: "Our team reviews listings for authenticity and cultural relevance before publishing." },
            { id: 4, title: "Get Discovered", description: "Your listings appear in our discovery feed. Boost visibility with optional featured placements." }
        ]
    }
}, { timestamps: true });

export default mongoose.model('HowItWork', howItWorkSchema);