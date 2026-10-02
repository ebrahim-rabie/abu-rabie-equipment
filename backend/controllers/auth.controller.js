const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { getEnv } = require('../config/env');

const generateToken = (admin) =>
  jwt.sign(
    { id: String(admin._id), type: 'admin', role: admin.role },
    getEnv().JWT_SECRET,
    { expiresIn: getEnv().JWT_EXPIRES_IN }
  );

/**
 * Rejects login attempts for accounts that have been locked out after repeated
 * failures. Tracked in memory, which is sufficient for a single-instance
 * deployment; a multi-instance setup would move this to MongoDB.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

const isLockedOut = (key) => {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() - record.first > LOCKOUT_MS) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
};

const recordFailure = (key) => {
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > LOCKOUT_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    record.count += 1;
  }
};

const clearFailures = (key) => attempts.delete(key);

// @desc    Admin login
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال اسم المستخدم وكلمة المرور',
      });
    }

    const identifier = String(username).trim().toLowerCase();
    const throttleKey = `${req.ip}:${identifier}`;

    if (isLockedOut(throttleKey)) {
      return res.status(429).json({
        success: false,
        message: 'تم إيقاف محاولات الدخول مؤقتاً بسبب تكرار المحاولات الخاطئة، حاول بعد 15 دقيقة',
      });
    }

    // The Admin collection is the single source of truth. There is no
    // environment-variable fallback and no offline bypass: a previous version
    // accepted ADMIN_USERNAME/ADMIN_PASSWORD from the environment and minted a
    // superadmin token without touching the database.
    const admin = await Admin.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });

    const passwordMatches = admin
      ? await admin.comparePassword(password)
      : // Keep the response time roughly constant whether or not the account exists
        await Admin.comparePasswordTiming(password);

    if (!admin || !passwordMatches) {
      recordFailure(throttleKey);
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة',
      });
    }

    clearFailures(throttleKey);

    admin.lastLogin = new Date();
    await admin.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      data: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        token: generateToken(admin),
      },
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Get current admin profile
// @route   GET /api/auth/me
// @access  Private (Admin)
const getMe = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('-password');
    if (!admin) {
      return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
    }
    return res.json({ success: true, data: admin });
  } catch (error) {
    return next(error);
  }
};

// @desc    Update admin password
// @route   PUT /api/auth/update-password
// @access  Private (Admin)
const updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال كلمة المرور الحالية والجديدة',
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل',
      });
    }

    const admin = await Admin.findById(req.admin._id);
    const isMatch = await admin.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور الحالية غير صحيحة',
      });
    }

    admin.password = newPassword;
    await admin.save();

    return res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح',
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  login,
  getMe,
  updatePassword,
  generateToken,
};