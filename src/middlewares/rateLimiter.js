import rateLimit from 'express-rate-limit';

// 1. Global Limiter: General protection for all API routes
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per window
  message: {
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// 2. Auth Limiter: Strict limit for Login, Register, and Become Creator
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 attempts per hour
  message: {
    message: 'Too many auth attempts. Please try again after an hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Tracking Limiter: Protect PPC clicks and Views from spam
export const trackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 clicks/views per minute
  message: {
    message: 'Action recorded. Please wait before clicking again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip counting if the request fails (optional)
  skipFailedRequests: true,
});
