import mongoose from 'mongoose';

const footerSchema = new mongoose.Schema({
    // ১. লোগো এবং টেক্সট
    aboutText: { type: String, default: "Connecting the world through authentic culture." },

    // ২. সোশ্যাল মিডিয়া (অ্যাডমিন শুধু লিঙ্ক দিবে)
    socialLinks: {
        instagram: { type: String, default: "" },
        pinterest: { type: String, default: "" },
        linkedin: { type: String, default: "" },
        facebook: { type: String, default: "" }
    },

    // ৩. ডাইনামিক লিঙ্ক লিস্ট (CMS লজিক)
    // অ্যাডমিন প্যানেল থেকে { label: "About", href: "/about" } এভাবে ডাটা পাঠাবে
    platformLinks: [
        { label: String, href: String }
    ],
    resourceLinks: [
        { label: String, href: String }
    ],
    legalLinks: [
        { label: String, href: String }
    ],

    // ৪. নিউজলেটার সেকশন
    newsletterTitle: { type: String, default: "Stay Connected" },
    newsletterDescription: { type: String, default: "Stay informed about cultural stories." }
}, { timestamps: true });

export const Footer = mongoose.model('Footer', footerSchema);