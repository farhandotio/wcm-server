import Faq from '../models/Faq.js';

// ১. সব FAQ গেট করা (সবাই দেখতে পারবে)
export const getAllFaqs = async (req, res) => {
    try {
        const faqs = await Faq.find().sort({ createdAt: -1 });
        res.status(200).json(faqs);
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

        res.status(200).json({
            message: 'FAQ updated successfully',
            data: updatedFaq
        });
    } catch (error) {
        res.status(500).json({ message: 'Update failed', error: error.message });
    }
};