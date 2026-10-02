const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'اسم المستخدم مطلوب'],
      unique: true,
      trim: true,
      minlength: [3, 'اسم المستخدم يجب ألا يقل عن 3 أحرف'],
    },
    email: {
      type: String,
      required: [true, 'البريد الإلكتروني مطلوب'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/\S+@\S+\.\S+/, 'يرجى إدخال بريد إلكتروني صالح'],
    },
    password: {
      type: String,
      required: [true, 'كلمة المرور مطلوبة'],
      minlength: [6, 'كلمة المرور يجب ألا تقل عن 6 أحرف'],
    },
    name: {
      type: String,
      default: 'م/ محمد أبو ربيع',
    },
    role: {
      type: String,
      enum: ['superadmin', 'admin'],
      default: 'admin',
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
adminSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * Burns roughly the same amount of time as a real comparison. Called by the
 * login controller when no account matches, so response timing does not reveal
 * whether a username exists.
 */
adminSchema.statics.comparePasswordTiming = async function (enteredPassword) {
  const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  await bcrypt.compare(String(enteredPassword || ''), DUMMY_HASH);
  return false;
};

module.exports = mongoose.model('Admin', adminSchema);
