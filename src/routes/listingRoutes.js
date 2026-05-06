import express from 'express';
import upload from '../config/multer.js';
import {
  createListing,
  getMyListings,
  updateListing,
  deleteListing,
  getPublicListings, // এটিই ট্রেন্ডিং এবং এক্সক্লুড লজিক হ্যান্ডেল করবে
  toggleFavorite,
  getCategoriesAndTags,
  getListingById,
  getCreatorListingCount,
  handlePpcClick,
  cancelPromotion,
  getMyFavorites,
  getModerationReasons,
  getCuratedCollections,
  getTrendingListings,
} from '../controllers/listingController.js';
import { getTagsByCategory } from '../controllers/adminController.js';
import { authMiddleware, authorizeRoles, optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────────────
// --- Public Routes (সবাই দেখতে পারবে) ---
// ──────────────────────────────────────────────────────────────────

// মডারেশন কারণসমূহ
router.get('/moderation-reasons', getModerationReasons);

// ট্রেন্ডিং লিস্টিং (এখানেই আমরা ?exclude=id1,id2 পাঠাব)
router.get('/public', optionalAuth, getPublicListings);

// হোম পেজের কিউরেটেড কালেকশন (ডায়নামিক রোটেশন)
router.get('/curated', getCuratedCollections);

// মেটা ডাটা এবং ক্রিয়েটর লিস্টিং কাউন্ট
router.get('/meta-data', getCategoriesAndTags);
router.get('/count/:creatorId', getCreatorListingCount);

// ক্যাটাগরি অনুযায়ী ট্যাগ ফেচ করা
router.get('/tags/by-category/:categoryId', getTagsByCategory);

// ──────────────────────────────────────────────────────────────────
// --- Favorite Routes ---
// ──────────────────────────────────────────────────────────────────
router.get('/favorites', authMiddleware, getMyFavorites);
router.post('/favorite/:id', authMiddleware, toggleFavorite);

// ──────────────────────────────────────────────────────────────────
// --- Engagement Routes ---
// ──────────────────────────────────────────────────────────────────
router.post('/:id/click', optionalAuth, handlePpcClick);
router.get('/trending', getTrendingListings);

// ──────────────────────────────────────────────────────────────────
// --- Creator Specific Routes (শুধুমাত্র ক্রিয়েটরদের জন্য) ---
// ──────────────────────────────────────────────────────────────────
router.get('/my-listings', authMiddleware, authorizeRoles('creator'), getMyListings);

router.post(
  '/add',
  authMiddleware,
  authorizeRoles('creator'),
  upload.single('image'),
  createListing
);

router.put(
  '/update/:id',
  authMiddleware,
  authorizeRoles('creator'),
  upload.single('image'),
  updateListing
);

router.delete('/delete/:id', authMiddleware, authorizeRoles('creator'), deleteListing);

// ──────────────────────────────────────────────────────────────────
// --- Individual Listing Routes ---
// ──────────────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, getListingById);
router.patch('/:id/cancel-promotion', authMiddleware, cancelPromotion);

export default router;