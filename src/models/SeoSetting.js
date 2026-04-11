import mongoose from 'mongoose';

const seoSettingSchema = new mongoose.Schema({
    pageName: {
        type: String,
        required: true,
        unique: true,
        // কোন কোন পেজের SEO অ্যাডমিন থেকে কন্ট্রোল করা যাবে
        enum: ['home', 'about', 'contact', 'explore']
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    keywords: [String],
}, { timestamps: true });

const SeoSetting = mongoose.model('SeoSetting', seoSettingSchema);
export default SeoSetting;