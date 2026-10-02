const rateLimit = require('express-rate-limit');
const { isProduction } = require('../config/env');

const message = (text) => ({ success: false, message: text });

/**
 * Rate limiters for the public, abuse-prone endpoints.
 *
 * Production limits are strict. Under test the multipliers are effectively
 * removed so a test run is never throttled, which would otherwise mask real
 * behaviour behind 429 responses.
 */
const isTest = process.env.NODE_ENV === 'test';
const scale = (productionLimit) => (isTest ? Number.MAX_SAFE_INTEGER : productionLimit);

const standardHeaders = 'draft-7';
const base = {
  standardHeaders,
  legacyHeaders: false,
};

const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: scale(10),
  // Only count failed attempts, so a busy admin is never locked out
  skipSuccessfulRequests: true,
  message: message('محاولات دخول كثيرة. يرجى المحاولة بعد 15 دقيقة.'),
});

const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: scale(5),
  message: message('تم تجاوز عدد محاولات إنشاء الحسابات المسموح بها. حاول لاحقاً.'),
});

const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: scale(5),
  message: message('محاولات تغيير كلمة المرور كثيرة. حاول لاحقاً.'),
});

const orderLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: scale(15),
  message: message(
    'تم إرسال عدد كبير من الطلبات. يرجى المحاولة لاحقاً أو التواصل معنا عبر واتساب.'
  ),
});

const contactLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: scale(8),
  message: message('تم إرسال عدد كبير من الرسائل. يرجى المحاولة لاحقاً.'),
});

const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: scale(100),
  message: message('تم تجاوز عدد الملفات المسموح برفعها.'),
});

/**
 * Broad safety net for the whole API. Generous enough not to affect browsing,
 * tight enough to stop a script hammering every endpoint.
 */
const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: isTest ? Number.MAX_SAFE_INTEGER : isProduction() ? 300 : 5000,
  // Health checks are issued by the platform, not by users
  skip: (req) => req.path === '/health',
  message: message('طلبات كثيرة جداً. يرجى الانتظار قليلاً.'),
});

module.exports = {
  apiLimiter,
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  orderLimiter,
  contactLimiter,
  uploadLimiter,
};