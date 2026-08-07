import rateLimit from 'express-rate-limit';

export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

export const rateLimitHandler = (req, res, _next, options) => {
  const resetTime = req.rateLimit?.resetTime?.getTime?.() || Date.now() + RATE_LIMIT_WINDOW_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(options.statusCode).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests from this IP. Please try again in up to 5 minutes.',
    retryAfterSeconds,
  });
};

export const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 200, 
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false, 
});
