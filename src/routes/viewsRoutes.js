import express from 'express';
import { trackVisitor } from '../controllers/viewsController.js';
import { optionalAuth } from '../middlewares/auth.js';

const router = express.Router();

router.post('/track', optionalAuth, trackVisitor);

export default router;
