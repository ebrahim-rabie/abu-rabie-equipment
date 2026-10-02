const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const { getEnv } = require('../config/env');
const {
  normalizeEgyptPhone,
  isValidEgyptPhone,
} = require('../utils/phone');

const generateCustomerToken = (user) =>
  jwt.sign({ id: String(user._id), type: 'customer' }, getEnv().JWT_SECRET, {
    expiresIn: getEnv().JWT_EXPIRES_IN,
  });

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  phone: user.phone,
  phoneVerified: user.phoneVerified,
  addresses: user.addresses,
  createdAt: user.createdAt,
});

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

// @desc    Register a customer account
// @route   POST /api/customers/auth/register
// @access  Public
const register = async (req, res, next) => {
  try {
    const { name, phone, password, confirmPassword } = req.body;

    if (!name || !phone || !password) {
      return fail(res, 400, 'يرجى إدخال الاسم ورقم الهاتف وكلمة المرور');
    }

    if (String(name).trim().length < 3) {
      return fail(res, 400, 'الاسم يجب ألا يقل عن 3 أحرف');
    }

    if (!isValidEgyptPhone(phone)) {
      return fail(
        res,
        400,
        'رقم الهاتف غير صحيح. مثال صحيح: 01012345678 أو +201012345678'
      );
    }

    if (String(password).length < 8) {
      return fail(res, 400, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
    }

    if (confirmPassword !== undefined && confirmPassword !== password) {
      return fail(res, 400, 'كلمة المرور وتأكيدها غير متطابقين');
    }

    const normalized = normalizeEgyptPhone(phone);

    const existing = await User.findOne({ phone: normalized });
    if (existing) {
      return fail(
        res,
        409,
        'هذا الرقم مسجل بالفعل. يرجى تسجيل الدخول بدلاً من ذلك.'
      );
    }

    const user = await User.create({
      name: String(name).trim(),
      phone: normalized,
      password,
      addresses: [],
    });

    // Ensure a cart document exists so later mutations are a single update
    await Cart.findOneAndUpdate(
      { user: user._id },
      { $setOnInsert: { user: user._id, items: [] } },
      { upsert: true, new: true }
    );

    return res.status(201).json({
      success: true,
      message: 'تم إنشاء حسابك بنجاح',
      data: { ...publicUser(user), token: generateCustomerToken(user) },
    });
  } catch (error) {
    // Duplicate key from a racing request
    if (error.code === 11000) {
      return fail(res, 409, 'هذا الرقم مسجل بالفعل');
    }
    if (error.name === 'ValidationError') {
      return fail(
        res,
        400,
        Object.values(error.errors)
          .map((e) => e.message)
          .join('، ')
      );
    }
    return next(error);
  }
};

// @desc    Customer login
// @route   POST /api/customers/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return fail(res, 400, 'يرجى إدخال رقم الهاتف وكلمة المرور');
    }

    const normalized = normalizeEgyptPhone(phone);

    const user = await User.findOne({ phone: normalized }).select('+password');
    const passwordMatches = user
      ? await user.comparePassword(password)
      : await User.comparePasswordTiming(password);

    if (!user || !passwordMatches) {
      return fail(res, 401, 'رقم الهاتف أو كلمة المرور غير صحيحة');
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      data: { ...publicUser(user), token: generateCustomerToken(user) },
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Current customer profile
// @route   GET /api/customers/auth/me
// @access  Private (Customer)
const getMe = async (req, res, next) => {
  try {
    return res.json({ success: true, data: publicUser(req.user) });
  } catch (error) {
    return next(error);
  }
};

// @desc    Update profile
// @route   PUT /api/customers/profile
// @access  Private (Customer)
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone } = req.body;

    if (name !== undefined) {
      if (String(name).trim().length < 3) {
        return fail(res, 400, 'الاسم يجب ألا يقل عن 3 أحرف');
      }
      req.user.name = String(name).trim();
    }

    if (phone !== undefined) {
      if (!isValidEgyptPhone(phone)) {
        return fail(res, 400, 'رقم الهاتف غير صحيح');
      }
      const normalized = normalizeEgyptPhone(phone);
      if (normalized !== req.user.phone) {
        const taken = await User.findOne({ phone: normalized });
        if (taken) return fail(res, 409, 'هذا الرقم مستخدم في حساب آخر');
        req.user.phone = normalized;
      }
    }

    await req.user.save();

    return res.json({
      success: true,
      message: 'تم تحديث البيانات بنجاح',
      data: publicUser(req.user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 409, 'هذا الرقم مستخدم في حساب آخر');
    }
    return next(error);
  }
};

// @desc    Change password
// @route   PUT /api/customers/password
// @access  Private (Customer)
const updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return fail(res, 400, 'يرجى إدخال كلمة المرور الحالية والجديدة');
    }

    if (String(newPassword).length < 8) {
      return fail(res, 400, 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
    }

    if (confirmPassword !== undefined && confirmPassword !== newPassword) {
      return fail(res, 400, 'كلمة المرور وتأكيدها غير متطابقين');
    }

    // `password` carries select: false, so req.user does not hold the hash and
    // it has to be loaded explicitly before it can be compared.
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return fail(res, 404, 'الحساب غير موجود');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return fail(res, 400, 'كلمة المرور الحالية غير صحيحة');
    }

    user.password = newPassword;
    await user.save();

    return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    return next(error);
  }
};

// @desc    Delete account
// @route   DELETE /api/customers/account
// @access  Private (Customer)
const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;

    if (!password) {
      return fail(res, 400, 'يرجى إدخال كلمة المرور لتأكيد حذف الحساب');
    }

    // The hash is excluded from req.user by default
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return fail(res, 404, 'الحساب غير موجود');

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return fail(res, 400, 'كلمة المرور غير صحيحة');
    }

    // Orders are deliberately retained: they are the shop's sales record.
    // The link to the account is broken so the customer record disappears.
    await Order.updateMany({ user: req.user._id }, { $unset: { user: 1 } });
    await Cart.deleteOne({ user: req.user._id });
    await User.deleteOne({ _id: req.user._id });

    return res.json({ success: true, message: 'تم حذف الحساب بنجاح' });
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

// @desc    List saved addresses
// @route   GET /api/customers/addresses
// @access  Private (Customer)
const getAddresses = async (req, res, next) => {
  try {
    return res.json({ success: true, data: req.user.addresses });
  } catch (error) {
    return next(error);
  }
};

// @desc    Add an address
// @route   POST /api/customers/addresses
// @access  Private (Customer)
const addAddress = async (req, res, next) => {
  try {
    const { label, phone, governorate, city, street, isDefault } = req.body;

    if (!street || String(street).trim().length < 5) {
      return fail(res, 400, 'يرجى كتابة العنوان بالتفصيل');
    }

    if (req.user.addresses.length >= 10) {
      return fail(res, 400, 'يمكن حفظ 10 عناوين كحد أقصى');
    }

    if (isDefault) {
      req.user.addresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    req.user.addresses.push({
      label: String(label || 'المنزل').trim().slice(0, 60),
      phone: String(phone || req.user.phone).trim().slice(0, 20),
      governorate: String(governorate || '').trim().slice(0, 80),
      city: String(city || '').trim().slice(0, 80),
      street: String(street).trim().slice(0, 300),
      isDefault: Boolean(isDefault),
    });

    await req.user.save();

    return res.status(201).json({
      success: true,
      message: 'تم حفظ العنوان بنجاح',
      data: req.user.addresses,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Update an address
// @route   PUT /api/customers/addresses/:id
// @access  Private (Customer)
const updateAddress = async (req, res, next) => {
  try {
    const address = req.user.addresses.id(req.params.id);

    if (!address) return fail(res, 404, 'العنوان غير موجود');

    const { label, phone, governorate, city, street, isDefault } = req.body;

    if (street !== undefined) {
      if (String(street).trim().length < 5) {
        return fail(res, 400, 'يرجى كتابة العنوان بالتفصيل');
      }
      address.street = String(street).trim().slice(0, 300);
    }
    if (label !== undefined) address.label = String(label).trim().slice(0, 60);
    if (phone !== undefined) address.phone = String(phone).trim().slice(0, 20);
    if (governorate !== undefined)
      address.governorate = String(governorate).trim().slice(0, 80);
    if (city !== undefined) address.city = String(city).trim().slice(0, 80);

    if (isDefault === true) {
      req.user.addresses.forEach((a) => {
        a.isDefault = false;
      });
      address.isDefault = true;
    }

    await req.user.save();

    return res.json({
      success: true,
      message: 'تم تحديث العنوان',
      data: req.user.addresses,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Delete an address
// @route   DELETE /api/customers/addresses/:id
// @access  Private (Customer)
const deleteAddress = async (req, res, next) => {
  try {
    const address = req.user.addresses.id(req.params.id);

    if (!address) return fail(res, 404, 'العنوان غير موجود');

    const wasDefault = address.isDefault;
    address.deleteOne();

    // Never leave an account with zero addresses marked as default
    if (wasDefault && req.user.addresses.length) {
      req.user.addresses[0].isDefault = true;
    }

    await req.user.save();

    return res.json({
      success: true,
      message: 'تم حذف العنوان',
      data: req.user.addresses,
    });
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

// @desc    Order history for the signed-in customer
// @route   GET /api/customers/orders
// @access  Private (Customer)
const getMyOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const query = { user: req.user._id };

    const [total, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      success: true,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: orders,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  updatePassword,
  deleteAccount,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getMyOrders,
  generateCustomerToken,
  publicUser,
};