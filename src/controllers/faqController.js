import Faq from '../models/Faq.js';
import TranslationRecord from '../models/TranslationRecord.js';
import { getEnabledLanguages } from '../config/supportedLanguages.js';
import {
    markObjectTranslationsOutdated,
    requestBulkTranslations,
} from '../services/translation/translationEngine.js';

const triggerFaqTranslations = async (faq, adminId, { sourceChanged = false } = {}) => {
    const sourceVersion = faq.updatedAt.getTime();

    if (sourceChanged) {
        await markObjectTranslationsOutdated({
            businessObjectType: 'faq',
            businessObjectId: faq._id,
            sourceVersion,
        });
    }

    return requestBulkTranslations(
        getEnabledLanguages()
            .filter(({ isSource }) => !isSource)
            .map(({ code }) => ({
                businessObjectType: 'faq',
                businessObjectId: faq._id,
                targetLanguageCode: code,
                sourceVersion,
                sourceContent: { title: faq.question, description: faq.answer },
                context: { requestedBy: adminId, requestedByRole: 'admin' },
            }))
    );
};

export const projectFrenchFaqs = (faqs, translations) => {
    const translatedByFaqId = new Map(
        translations.map((translation) => [String(translation.businessObjectId), translation.content])
    );

    return faqs.map((faq) => {
        const serializedFaq = typeof faq.toObject === 'function' ? faq.toObject() : faq;
        const translation = translatedByFaqId.get(String(serializedFaq._id));

        return translation
            ? {
                ...serializedFaq,
                question: translation.title || serializedFaq.question,
                answer: translation.description || serializedFaq.answer,
            }
            : serializedFaq;
    });
};

// ১. সব FAQ গেট করা (সবাই দেখতে পারবে)
export const getAllFaqs = async (req, res) => {
    try {
        const faqs = await Faq.find().sort({ createdAt: -1 });
        if (req.query.language !== 'fr') {
            return res.status(200).json(faqs);
        }

        const translations = await TranslationRecord.find({
            businessObjectType: 'faq',
            businessObjectId: { $in: faqs.map((faq) => faq._id) },
            languageCode: 'fr',
            publicationStatus: 'published',
        }).select('businessObjectId content').lean();

        const localizedFaqs = projectFrenchFaqs(faqs, translations);

        return res.status(200).json(localizedFaqs);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ২. নতুন FAQ অ্যাড করা (শুধু Admin পারবে)
export const createFaq = async (req, res) => {
    try {
        const { question, answer, category } = req.body;

        if (!question || !answer || !category) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        const newFaq = await Faq.create({ question, answer, category });
        await triggerFaqTranslations(newFaq, req.user._id);
        res.status(201).json(newFaq);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create FAQ', error: error.message });
    }
};

// ৩. FAQ ডিলিট করা (শুধু Admin পারবে)
export const deleteFaq = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedFaq = await Faq.findByIdAndDelete(id);

        if (!deletedFaq) {
            return res.status(404).json({ message: 'FAQ not found' });
        }

        res.status(200).json({ message: 'FAQ deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Delete failed', error: error.message });
    }
};
// ৪. FAQ আপডেট করা (Admin Only)
export const updateFaq = async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer, category } = req.body;

        const updatedFaq = await Faq.findByIdAndUpdate(
            id,
            { question, answer, category },
            { new: true, runValidators: true } // 'new: true' দিলে আপডেট হওয়া ডেটা রিটার্ন করবে
        );

        if (!updatedFaq) {
            return res.status(404).json({ message: 'FAQ not found' });
        }

        if (question !== undefined || answer !== undefined) {
            await triggerFaqTranslations(updatedFaq, req.user._id, { sourceChanged: true });
        }

        res.status(200).json({
            message: 'FAQ updated successfully',
            data: updatedFaq
        });
    } catch (error) {
        res.status(500).json({ message: 'Update failed', error: error.message });
    }
};
