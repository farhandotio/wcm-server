import express from 'express';
import { getFooter, saveFooterSettings } from '../controllers/footerController.js';

const router = express.Router();

// পাবলিকলি ফুটার দেখানোর জন্য
router.get('/', getFooter);

// অ্যাডমিন প্যানেল থেকে অ্যাড/এডিট/সেভ করার জন্য
router.put('/', saveFooterSettings);

export default router;