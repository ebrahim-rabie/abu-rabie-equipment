const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { getEnv } = require('../config/env');

const extractToken = (req) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer')) return null;
  const token = header.split(' ')[1];
  return token && token.trim() ? token.trim() : null;
};

/**
 * Verifies an admin JWT and loads the matching Admin document.
 *
 * There is deliberately no "offline mode" shortcut here: an earlier version
 * granted superadmin to any correctly signed token whenever MongoDB was
 * unreachable, which turned a database outage into a full authentication
 * bypass. A token that does not resolve to a live admin account is a 401.
 */
const protect = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'غير مصرح بالدخول، يرجى تسجيل الدخول أولاً',
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getEnv().JWT_SECRET);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'جلسة الدخول منتهية أو غير صالحة',
    });
  }

  // An admin token must not be usable as a customer token or vice versa
  if (decoded.type && decoded.type !== 'admin') {
    return res.status(401).json({
      success: false,
      message: 'نوع الجلسة غير صالح',
    });
  }

  try {
    const admin = await Admin.findById(decoded.id).select('-password');

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'الحساب غير موجود أو تم حذفه',
      });
    }

    req.admin = admin;
    return next();
  } catch (error) {
    // A token whose id is not a valid ObjectId identifies nobody, which is an
    // authentication failure rather than a server fault.
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
 * Restricts a route to superadmin accounts. Use after `protect`.
 */
const superadminOnly = (req, res, next) => {
  if (!req.admin || req.admin.role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      message: 'هذه الصفحة مخصصة للمدير العام فقط',
    });
  }
  return next();
};

module.exports = { protect, superadminOnly, extractToken };