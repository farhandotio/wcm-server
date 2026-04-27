import express from 'express';
const router = express.Router();

import {
    updateSeoSettings,
    getSeoSettingsByPage,
    getAllSeoSettings,
    deleteSeoSetting
} from '../controllers/seoController.js';

// ডাটা আপডেট বা পোস্ট করার জন্য
router.post('/update', updateSeoSettings);

// সব ডাটা লিস্ট পাওয়ার জন্য
router.get('/all', getAllSeoSettings);

// নির্দিষ্ট পেজের ডাটা পাওয়ার জন্য
router.get('/:pageName', getSeoSettingsByPage);

// আইডি দিয়ে ডিলিট করার জন্য
router.delete('/delete/:id', deleteSeoSetting);

export default router;