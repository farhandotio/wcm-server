import express from 'express';
const router = express.Router();
import { updateSeo, getSeoByPage } from '../controllers/seoController.js';

// অ্যাডমিন প্যানেল থেকে ডাটা সেভ করার জন্য
router.post('/update', updateSeo);

// ফ্রন্টএন্ডে ডাটা দেখানোর জন্য (Public Route)
router.get('/:pageName', getSeoByPage);

export default router;