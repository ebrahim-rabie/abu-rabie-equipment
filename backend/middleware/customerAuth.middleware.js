const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getEnv } = require('../config/env');
const { extractToken } = require('./auth.middleware');

/**
 * Verifies a customer JWT.
 *
 * Distinct from the admin `protect` middleware: the token must carry
 * `type: 'customer'`, so an admin session token cannot be replayed against
 * customer endpoints and vice versa. The user document is always loaded from
 * the database, meaning a deleted account stops working immediately.
 */
const protectCustomer = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'يرجى تسجيل الدخول للمتابعة',
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getEnv().JWT_SECRET);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'جلسة الدخول منتهية، يرجى تسجيل الدخول مرة أخرى',
    });
  }

  if (decoded.type !== 'customer') {
    return res.status(401).json({
      success: false,
      message: 'نوع الجلسة غير صالح',
    });
  }

  try {
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'الحساب غير موجود',
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    // A token id that is not a valid ObjectId identifies nobody
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(401).json({
        success: false,
        message: 'جلسة الدخول غير صالحة',
      });
    }

    return res.status(503).json({
      success: false,
      message: 'تعذر التحقق من الحساب حالياً، يرجى المحاولة بعد قليل',
    });
  }
};

/**
 * Attaches req.user when a valid customer token is present, but never rejects.
 * Used by guest-compatible endpoints such as order creation.
 */
const optionalCustomer = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET);
    if (decoded.type !== 'customer') return next();
    const user = await User.findById(decoded.id).select('-password');
    if (user) req.user = user;
  } catch (error) {
    // An invalid token is treated as "not signed in" rather than an error
  }

  return next();
};

module.exports = { protectCustomer, optionalCustomer };