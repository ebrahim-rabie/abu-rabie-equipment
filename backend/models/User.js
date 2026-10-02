const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 60, default: 'المنزل' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    governorate: { type: String, trim: true, maxlength: 80, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    street: { type: String, trim: true, maxlength: 300, default: '' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'الاسم مطلوب'],
      trim: true,
      maxlength: [120, 'الاسم طويل جداً'],
    },
    password: {
      type: String,
      required: [true, 'كلمة المرور مطلوبة'],
      minlength: [8, 'كلمة المرور يجب ألا تقل عن 8 أحرف'],
      select: false,
    },
    role: {
      type: String,
      enum: ['customer'],
      default: 'customer',
    },
    addresses: {
      type: [addressSchema],
      default: [],
    },
    // Set once the owner confirms ownership over WhatsApp. There is no SMS
    // verification, so this is informational only and never gates access.
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * Burns roughly the same amount of time as a real comparison, so login timing
 * does not reveal whether a phone number is registered.
 */
userSchema.statics.comparePasswordTiming = async function (enteredPassword) {
  const bcrypt = require('bcryptjs');
  const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  await bcrypt.compare(String(enteredPassword || ''), DUMMY_HASH);
  return false;
};

// Exactly one default address per account
userSchema.pre('save', function (next) {
  if (!this.isModified('addresses') || !this.addresses.length) return next();
  const defaults = this.addresses.filter((a) => a.isDefault);
  if (defaults.length === 1) return next();
  if (defaults.length > 1) {
    // Keep only the first default; demote the rest
    let seen = false;
    for (const addr of this.addresses) {
      if (addr.isDefault) {
        if (seen) addr.isDefault = false;
        seen = true;
      }
    }
  } else {
    this.addresses[0].isDefault = true;
  }
  return next();
});

module.exports = mongoose.model('User', userSchema);