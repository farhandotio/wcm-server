import { Footer } from '../models/Footer.js';
import { triggerCmsTranslations } from '../services/translation/cmsTranslationTrigger.js';
import { projectLocalizedObject, sendPublicLanguageError } from '../services/translation/publicLocalizationService.js';

// ১. ফুটার ডাটা দেখা (Public - Footer Component এর জন্য)
export const getFooter = async (req, res) => {
    try {
        const footer = await Footer.findOne();
        if (!footer) {
            return res.status(404).json({ success: false, message: "No footer data found" });
        }
        const localizedFooter = await projectLocalizedObject({ businessObjectType: 'cms', object: footer, language: req.query.language });
        res.status(200).json({ success: true, data: localizedFooter });
    } catch (error) {
        if (error.status) return sendPublicLanguageError(res, error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ২. ডাটা অ্যাড বা আপডেট করা (Admin - CMS Panel এর জন্য)
// এই একটি ফাংশন দিয়েই অ্যাডমিন ডাটা প্রথমবার অ্যাড করতে পারবে এবং পরে এডিট করতে পারবে
export const saveFooterSettings = async (req, res) => {
    try {
        // এখানে আমরা কোন আইডি ছাড়াই আপডেট করছি কারণ ফুটার অবজেক্ট একটাই থাকবে
        const updatedFooter = await Footer.findOneAndUpdate(
            {}, // empty filter মানে প্রথম ডকুমেন্টটিই ধরবে
            { $set: req.body }, // অ্যাডমিন প্যানেল থেকে যা পাঠাবে সব সেট হবে
            { new: true, upsert: true, runValidators: true }
            // upsert: true মানে হলো ডাটা না থাকলে নতুন তৈরি করবে (Add), থাকলে আপডেট করবে (Edit)
        );

        await triggerCmsTranslations({
            cmsKey: 'footer',
            document: updatedFooter,
            adminId: req.user?._id,
            sourceChanged: true,
        });

        res.status(200).json({
            success: true,
            message: "Footer content saved successfully!",
            data: updatedFooter
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ৩. ডিলিট লজিক (Delete)
// লিঙ্কগুলো ডিলিট করার জন্য অ্যাডমিন প্যানেল থেকে শুধু ওই লিঙ্কটা বাদ দিয়ে পুরো অ্যারে আবার পাঠাতে হয়
// কিন্তু আপনি যদি স্পেসিফিক কোনো সেকশন ক্লিয়ার করতে চান:
export const resetFooterSection = async (req, res) => {
    try {
        const { section } = req.body; // ধরুন অ্যাডমিন চাচ্ছে 'platformLinks' ডিলিট করতে

        const update = {};
        update[section] = []; // ওই সেকশনকে খালি করে দিবে

        const updatedFooter = await Footer.findOneAndUpdate(
            {},
            { $set: update },
            { new: true, runValidators: true }
        );

        if (updatedFooter) {
            await triggerCmsTranslations({
                cmsKey: 'footer',
                document: updatedFooter,
                adminId: req.user?._id,
                sourceChanged: true,
            });
        }

        res.status(200).json({ success: true, message: `${section} has been cleared!` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
