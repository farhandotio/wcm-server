import SeoSetting from '../models/SeoSetting.js';

// ১. পেজ অনুযায়ী এসইও ডাটা আপডেট বা তৈরি করা (Upsert)
export const updateSeoSettings = async (req, res) => {
    const { pageName, title, description, keywords } = req.body;
    try {
        const updatedSetting = await SeoSetting.findOneAndUpdate(
            { pageName },
            { title, description, keywords },
            { new: true, upsert: true } // ডাটা না থাকলে তৈরি করবে, থাকলে আপডেট করবে
        );
        res.status(200).json(updatedSetting);
    } catch (error) {
        res.status(500).json({ message: "Failed to update SEO settings", error: error.message });
    }
};

// ২. নির্দিষ্ট একটি পেজের ডাটা খুঁজে বের করা
export const getSeoSettingsByPage = async (req, res) => {
    try {
        const { pageName } = req.params;
        const settings = await SeoSetting.findOne({ pageName });
        if (!settings) {
            return res.status(404).json({ message: "No SEO settings found for this page" });
        }
        res.status(200).json(settings);
    } catch (error) {
        res.status(500).json({ message: "Error fetching SEO data", error: error.message });
    }
};

// ৩. সব এসইও ডাটা একসাথে পাওয়া (অ্যাডমিন টেবিলের জন্য)
export const getAllSeoSettings = async (req, res) => {
    try {
        const settings = await SeoSetting.find().sort({ updatedAt: -1 });
        res.status(200).json(settings);
    } catch (error) {
        res.status(500).json({ message: "Error fetching all SEO settings", error: error.message });
    }
};

// ৪. এসইও ডাটা ডিলিট করা
export const deleteSeoSetting = async (req, res) => {
    try {
        const { id } = req.params;
        await SeoSetting.findByIdAndDelete(id);
        res.status(200).json({ message: "SEO setting deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting SEO setting", error: error.message });
    }
};