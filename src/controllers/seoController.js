import SeoSetting from '../models/SeoSetting.js';

// ১. এই ফাংশনটি দিয়ে অ্যাডমিন SEO ডাটা সেভ বা আপডেট করবে
export const updateSeo = async (req, res) => {
    try {
        const { pageName, title, description, keywords } = req.body;

        const seo = await SeoSetting.findOneAndUpdate(
            { pageName },
            { title, description, keywords },
            { upsert: true, new: true } // ডাটা না থাকলে তৈরি করবে, থাকলে আপডেট করবে
        );

        res.status(200).json({ success: true, data: seo });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ২. এই ফাংশনটি দিয়ে ফ্রন্টএন্ড (Next.js) ডাটা নিয়ে যাবে
export const getSeoByPage = async (req, res) => {
    try {
        const seo = await SeoSetting.findOne({ pageName: req.params.pageName });
        if (!seo) return res.status(404).json({ success: false, message: "No SEO data found" });

        res.status(200).json(seo);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};