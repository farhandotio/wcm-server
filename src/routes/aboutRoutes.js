import express from 'express';
import upload from '../config/multer.js'; // আপনার তৈরি করা মাল্টার কনফিগ
import {
    getAboutPage,
    resetAboutPage,
    updateAboutHeader,
    updateIntroSection,
    updateIntroSingleImage,
    updateStorySection,
    updateExplorerJourney,
    updateExplorerStep,
    addExplorerStep,
    deleteExplorerStep,
    updatePrinciplesSection,
    addPrincipleCard,
    updatePrincipleCard,
    deletePrincipleCard,
    updateVisionSection,
    addVisionFeature,
    updateVisionFeature,
    deleteVisionFeature,
    updateVisibilitySection
} from '../controllers/aboutController.js';

const router = express.Router();

// ════════════════════════════════════════════════════════════
// ১. FULL PAGE ROUTES
// ════════════════════════════════════════════════════════════
router.get('/', getAboutPage);
router.delete('/reset', resetAboutPage);

// ════════════════════════════════════════════════════════════
// ২. SECTION WISE UPDATES
// ════════════════════════════════════════════════════════════

// About Header
router.patch('/header', updateAboutHeader);

// Intro Section (Multiple images upload support)
// এখানে 'gridImages' ফিল্ড নেম এবং সর্বোচ্চ ৪টি ছবি সাপোর্ট করবে
router.patch('/intro', upload.array('gridImages', 4), updateIntroSection);
router.patch('/intro/image/:index', upload.single('gridImage'), updateIntroSingleImage);

// Story Section (Single image upload)
router.patch('/story', upload.single('mainImage'), updateStorySection);

// Explorer Journey
router.patch('/explorer', updateExplorerJourney);
router.post('/explorer/step', addExplorerStep);
router.patch('/explorer/step/:index', updateExplorerStep);
router.delete('/explorer/step/:index', deleteExplorerStep);

// Principles Section
router.patch('/principles', updatePrinciplesSection);
router.post('/principles/card', addPrincipleCard);
router.patch('/principles/card/:index', updatePrincipleCard);
router.delete('/principles/card/:index', deletePrincipleCard);

// Vision Section (Single image upload for card)
router.patch('/vision', upload.single('imageCard'), updateVisionSection);
router.post('/vision/feature', addVisionFeature);
router.patch('/vision/feature/:index', updateVisionFeature);
router.delete('/vision/feature/:index', deleteVisionFeature);

// Visibility Section
router.patch('/visibility', updateVisibilitySection);

export default router;