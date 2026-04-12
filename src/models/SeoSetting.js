import mongoose from 'mongoose';

const seoSettingSchema = new mongoose.Schema({
    pageName: {
        type: String,
        required: true,
        unique: true,
        // এখানে 'faq' যোগ করা হয়েছে
        enum: ['home', 'about', 'contact', 'explore', 'blog', 'faq', 'creators','how-it-works']
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    keywords: [String],
}, { timestamps: true });

// মডেল এক্সপোর্ট করার আগে চেক করে নেওয়া ভালো যেন বারবার মডেল ক্রিয়েট না হয়
const SeoSetting = mongoose.models.SeoSetting || mongoose.model('SeoSetting', seoSettingSchema);
export default SeoSetting;