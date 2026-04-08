import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import cors from 'cors';

import userRoutes from './routes/userRoutes.js';
import listingRoutes from './routes/listingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import creatorRoutes from './routes/creatorRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import sliderRoutes from './routes/sliderRoutes.js';
import blogRoutes from './routes/blogRoutes.js';
import viewsRoutes from './routes/viewsRoutes.js';

const app = express();
app.set('trust proxy', 1);

const __dirname = path.resolve();

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  })
);

app.use(cookieParser());

// Stripe Webhook এর জন্য এটি json() এর উপরে থাকা ভালো
app.use('/api/payments', paymentRoutes);

app.use(express.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/creator', creatorRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/sliders', sliderRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/views', viewsRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Server is running....');
});

export default app;