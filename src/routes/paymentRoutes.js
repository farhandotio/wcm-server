import express from 'express';
import {
  cancelPromotion,
  createCheckoutSession,
  generateInvoice,
  handleStripeWebhook,
  purchasePromotion,
  togglePausePromotion,
} from '../controllers/PaymentController.js';
import { authMiddleware, requireActiveAccount } from '../middlewares/auth.js';

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

router.post(
  '/create-checkout-session',
  express.json(),
  authMiddleware,
  requireActiveAccount,
  createCheckoutSession
);

router.post(
  '/purchase-promotion',
  express.json(),
  authMiddleware,
  requireActiveAccount,
  purchasePromotion
);

router.post(
  '/cancel-promotion',
  express.json(),
  authMiddleware,
  requireActiveAccount,
  cancelPromotion
);

router.get('/creator/invoice/:id', express.json(), authMiddleware, generateInvoice);
router.post(
  '/toggle-pause-promotion',
  express.json(),
  authMiddleware,
  requireActiveAccount,
  togglePausePromotion
);

export default router;
