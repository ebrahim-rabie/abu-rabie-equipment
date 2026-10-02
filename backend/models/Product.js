const mongoose = require('mongoose');

/**
 * Builds a stable slug from Arabic or Latin text.
 *
 * The previous implementation appended a random four-digit suffix, so every save
 * produced a new slug and any bookmarked product URL broke. Slugs are now
 * derived from the SKU (or the imported sourceId) and are therefore stable
 * across re-imports.
 */
const buildSlug = ({ sku, sourceId, name }) => {
  const base = String(sku || sourceId || name || 'product')
    .toLowerCase()
    .trim()
    .replace(/[ً-ًٟ-ٰٟ]/g, '') // Arabic diacritics
    .replace(/[^\u0621-\u064Aa-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return base || 'product';
};

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم المنتج مطلوب'],
      trim: true,
      maxlength: [250, 'اسم المنتج طويل جداً'],
    },
    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
    },
    // Stable identifier carried over from the imported dataset, so re-running
    // the seeder updates rows instead of inserting duplicates.
    //
    // Indexes are owned by config/indexes.js. Declaring them here as well makes
    // Mongoose build them on connect, which conflicts with the partial unique
    // definitions there (same generated name, different options).
    sourceId: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: [5000, 'الوصف طويل جداً'],
    },
    sku: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'كود التخزين طويل جداً'],
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: false,
    },
    categoryName: {
      type: String,
      default: 'معدات عامة',
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
      default: 'أخرى',
    },
    price: {
      type: Number,
      required: [true, 'سعر المنتج مطلوب'],
      min: [0, 'السعر لا يمكن أن يكون سالباً'],
    },
    salePrice: {
      type: Number,
      default: null,
      min: [0, 'سعر العرض لا يمكن أن يكون سالباً'],
    },
    discountPct: {
      type: Number,
      default: 0,
      min: [0, 'نسبة الخصم لا يمكن أن تكون سالبة'],
      max: [100, 'نسبة الخصم لا يمكن أن تتجاوز 100%'],
    },
    image: {
      type: String,
      default: '',
    },
    images: {
      type: [String],
      default: [],
    },
    inStock: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    specs: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// NOTE: the `category_stock` index for { category, inStock, sortOrder } is
// declared in config/indexes.js so the whole index set lives in one place.

// Derive the discount, the primary image, and the slug before saving.
productSchema.pre('save', function (next) {
  if (this.salePrice && this.price && this.salePrice < this.price) {
    this.discountPct = Math.round(((this.price - this.salePrice) / this.price) * 100);
  } else {
    this.discountPct = 0;
  }

  if (!this.image && this.images && this.images.length > 0) {
    this.image = this.images[0];
  }

  if (!this.slug) {
    this.slug = buildSlug(this);
  }

  next();
});

module.exports = mongoose.model('Product', productSchema);
module.exports.buildSlug = buildSlug;