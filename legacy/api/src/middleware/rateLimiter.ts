import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again in 15 minutes' },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded. Please slow down.' },
});
