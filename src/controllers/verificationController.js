import Verification from '../models/Verification.js';

export const getVerifications = async (req, res) => {
    try {
        const verifications = await Verification.find({ isActive: true }).sort({ order: 1 });
        res.status(200).json({
            success: true,
            count: verifications.length,
            data: verifications
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getVerification = async (req, res) => {
    try {
        const verification = await Verification.findById(req.params.id);
        if (!verification) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        res.status(200).json({ success: true, data: verification });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export const createVerification = async (req, res) => {
    try {
        const verification = await Verification.create(req.body);
        res.status(201).json({ success: true, data: verification });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

export const updateVerification = async (req, res) => {
    try {
        const verification = await Verification.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!verification) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        res.status(200).json({ success: true, data: verification });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

export const deleteVerification = async (req, res) => {
    try {
        const verification = await Verification.findByIdAndDelete(req.params.id);
        if (!verification) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};