const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: false,
  },
  name: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    default: '',
  },
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
  },
  image: {
    type: String,
    default: '',
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
    },
    customerName: {
      type: String,
      required: [true, 'اسم العميل مطلوب'],
      trim: true,
    },
    customerPhone: {
      type: String,
      required: [true, 'رقم هاتف العميل مطلوب'],
      trim: true,
    },
    customerAddress: {
      type: String,
      required: [true, 'عنوان التوصيل مطلوب'],
      trim: true,
    },
    // Optional: set when a signed-in customer places the order. Guest checkout
    // leaves it undefined so existing flows keep working.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    governorate: {
      type: String,
      trim: true,
      default: '',
    },
    items: {
      type: [orderItemSchema],
      required: [true, 'يجب أن يحتوي الطلب على منتج واحد على الأقل'],
      validate: [val => val.length > 0, 'سلة الطلب فارغة'],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['جديد', 'قيد التنفيذ', 'تم الشحن', 'مكتمل', 'ملغي'],
      default: 'جديد',
    },
    notes: {
      type: String,
      default: '',
    },
    whatsappSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate order number before validation
orderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(100 + Math.random() * 900);
    this.orderNumber = `ABU-${timestamp}-${random}`;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
