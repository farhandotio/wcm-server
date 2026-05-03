import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import cors from 'cors';
import { globalLimiter } from './utils/rateLimiter.js';

// --- Existing Routes ---
import userRoutes from './routes/userRoutes.js';
import listingRoutes from './routes/listingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import creatorRoutes from './routes/creatorRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import sliderRoutes from './routes/sliderRoutes.js';
import blogRoutes from './routes/blogRoutes.js';
import viewsRoutes from './routes/viewsRoutes.js';
import faqRoutes from './routes/faqRoutes.js';
import seoRoutes from './routes/seoRoutes.js';
import footerRoutes from './routes/footerRoutes.js';

// --- New About Route (Based on our Discussion) ---
import aboutRoutes from './routes/aboutRoutes.js';

const app = express();

// Proxy trust for rate limiting (if using Vercel/Render/Heroku)
app.set('trust proxy', 1);

const __dirname = path.resolve();

// --- Middlewares ---
const clientURL = process.env.CLIENT_URL;

const allowedOrigins = [
  'http://localhost:3000',
  clientURL,
].filter(Boolean); 

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith(clientURL?.split('://')[1])) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  })
);

app.use(cookieParser());
app.use(globalLimiter);

/**
 * ⚠️ IMPORTANT: 
 * Stripe Webhook route must be BEFORE express.json()
 * because it needs the raw body to verify the signature.
 */
app.use('/api/payments', paymentRoutes);

// General JSON Parsing
app.use(express.json());

// --- Routes Registration ---
app.use('/api/users', userRoutes);
app.use('/api/creator', creatorRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/sliders', sliderRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/views', viewsRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/footer', footerRoutes);

/**
 * @section About Page Route
 * This handles all dynamic content for the About Us page
 * Powered by AboutPageSchema and AboutController
 */
app.use('/api/about', aboutRoutes);

// --- Static Assets ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root Route
app.get('/', (req, res) => {
  res.send('World Culture Marketplace (WCM) Server is running....');
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
});

export default app;