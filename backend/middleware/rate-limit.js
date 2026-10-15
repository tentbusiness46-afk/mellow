const rateLimit = require('express-rate-limit');

// Applied only to login endpoints - generous enough for a retailer fumbling
// their password a few times, tight enough to blunt brute-force attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

module.exports = { loginLimiter };
