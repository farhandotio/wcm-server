import express from 'express';
import {
  createCheckoutSession,
  generateInvoice,
  handleStripeWebhook,
} from '../controllers/PaymentController.js';
import { authMiddleware } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

router.post(
  '/create-checkout-session',
  authLimiter,
  express.json(),
  authMiddleware,
  createCheckoutSession
);

router.get('/creator/invoice/:id', authLimiter, authMiddleware, generateInvoice);

export default router;
