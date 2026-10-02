const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { buildSlug } = require('../models/Product');
const { syncIndexes } = require('../config/indexes');

/**
 * Seed the database from the scraped elkhalily dataset.
 *
 *   npm run seed              upsert everything (idempotent)
 *   npm run seed -- --reset   drop products and categories first
 *
 * The run is idempotent: each record is matched on `sourceId` (the id carried
 * over from the scrape), so re-running updates rows in place instead of
 * creating duplicates.
 */

// The four shop-facing categories. Raw WooCommerce category strings are mapped
// onto these because the source data contains roughly a hundred of them, which
// is useless as a filter list.
const CATEGORY_MAP = [
  {
    slug: 'power-tools',
    name: 'معدات كهربائية',
    description: 'شنيورات، صواريخ، هيلتي، ومعدات ثقيلة من أقوى الماركات',
    icon: 'fa-solid fa-plug',
    sortOrder: 1,
    match: [
      'صاروخ',
      'شنيور',
      'دريل',
      'هيلتي',
      'مثقاب',
      'منشار',
      'جلافة',
      'غسيل ضغط',
      'لحام',
      'كمبرسور',
      'مولد',
      'ماتور',
      'مواتير',
      'مضخة',
      'ميزان',
      'كاوتش',
      'ميزان كهرباء',
      'مفك كهرباء',
      'UMBER',
      'بطارية',
      'شاحن',
    ],
  },
  {
    slug: 'hand-tools',
    name: 'عدد يدوية',
    description: 'تشكيلة كاملة من المفاتيح، المفكات، الشواكيش، والكماشات',
    icon: 'fa-solid fa-screwdriver-wrench',
    sortOrder: 2,
    match: [
      'مفتاح',
      'طقم',
      'كماشة',
      'زرادية',
      'شاكوش',
      'مسمار',
      'سكين',
      'مقص',
      'entang',
      'مبرد',
      'ميزان Lasers',
      'laser',
      'LINER',
      'BENCH',
    ],
  },
  {
    slug: 'spare-parts',
    name: 'قطع غيار وصيانة',
    description: 'تروس، فلاتر، و قطع غيار أصلية لكل المعدات',
    icon: 'fa-solid fa-oil-can',
    sortOrder: 3,
    match: [
      'قطعة',
      'قطع غيار',
      'تروس',
      'فلتر',
      'مسامير',
      'كابل',
      'سلك',
      'حبل',
      'خرطوم',
      'جل',
      'زيت',
      'قطعه',
      'Accessories',
    ],
  },
  {
    slug: 'batteries-chargers',
    name: 'بطاريات وشواحن',
    description: 'بطاريات ليثيوم وشواحن سريعة لجميع فولتات المعدات',
    icon: 'fa-solid fa-car-battery',
    sortOrder: 4,
    match: ['بطارية', 'بطاريه', 'شاحن', 'BATTERY', 'CHARGER'],
  },
];

const FALLBACK_CATEGORY = {
  slug: 'others',
  name: 'أخرى',
  description: 'منتجات متنوعة',
  icon: 'fa-solid fa-box',
  sortOrder: 99,
};

const DEFAULT_IMAGE = 'assets/logo.jpg';
const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.RENDER
    ? '/var/data/uploads'
    : path.join(__dirname, '../uploads');
const localProductImagesDir = path.join(uploadsDir, 'product-images');

const loadLocalProductImages = () => {
  const bySourceId = new Map();
  if (!fs.existsSync(localProductImagesDir)) return bySourceId;

  for (const filename of fs.readdirSync(localProductImagesDir)) {
    const match = filename.match(/^(\d+)-(\d+)\.(?:jpe?g|png|webp|avif|gif)$/i);
    if (!match) continue;
    const paths = bySourceId.get(match[1]) || [];
    paths.push({ order: Number(match[2]), path: `/uploads/product-images/${filename}` });
    bySourceId.set(match[1], paths);
  }

  for (const [sourceId, paths] of bySourceId) {
    bySourceId.set(sourceId, paths.sort((a, b) => a.order - b.order).map((entry) => entry.path));
  }
  return bySourceId;
};

const localProductImages = loadLocalProductImages();

// The scraped catalogue lives in data/ at the repository root, next to the
// scraper that produces it.
const datasetPaths = [
  path.join(__dirname, '../../data/elkhalily_products.json'),
  path.join(__dirname, '../elkhalily_products.json'),
  path.join(__dirname, 'elkhalily_products.json'),
];

const loadDataset = ({ say = console.log } = {}) => {
  for (const p of datasetPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(raw) && raw.length) {
        say(`📦 Loaded ${raw.length} records from ${p}`);
        return raw;
      }
    } catch (err) {
      console.warn(`⚠️  Could not parse ${p}: ${err.message}`);
    }
  }
  console.warn('⚠️  No dataset found. Run run_scraper.bat first.');
  return [];
};

/** The scraped `categories` field ends with the "add to cart" button label. */
const cleanCategories = (raw) =>
  String(raw || '')
    .split('|')
    .map((s) => s.trim())
    .filter(
      (s) => s && !s.includes('إضافة إلى السلة') && !s.toLowerCase().includes('add-to-cart')
    );

const parseSpecs = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** Maps a raw WooCommerce category string onto one of the four shop categories. */
const resolveCategoryName = (rawName) => {
  const name = String(rawName || '').trim();
  if (!name) return FALLBACK_CATEGORY.name;

  const lower = name.toLowerCase();

  // Batteries win over the generic power-tools bucket when both would match
  for (const category of [...CATEGORY_MAP].reverse()) {
    if (category.match.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return category.name;
    }
  }

  return FALLBACK_CATEGORY.name;
};

const toProductDoc = (item, index, categoryIds) => {
  const price = Number(item.regular_price_egp) || 0;
  const salePrice = item.sale_price_egp ? Number(item.sale_price_egp) : null;
  const discount =
    salePrice && price > salePrice
      ? Math.round(((price - salePrice) / price) * 100)
      : Number(item.discount_pct) || 0;

  const [rawCategory] = cleanCategories(item.categories);
  const categoryName = resolveCategoryName(rawCategory);

  const gallery = String(item.images || '')
    .split('|')
    .map((s) => s.trim())
    .filter((u) => /^https?:\/\//.test(u));

  const localGallery = localProductImages.get(String(item.id || '')) || [];
  const image = localGallery[0] || item.image || gallery[0] || DEFAULT_IMAGE;

  const doc = {
    sourceId: String(item.id || `row-${index + 1}`),
    name: String(item.name || '').trim().slice(0, 250),
    sku: String(item.sku || '').trim().slice(0, 120),
    brand: String(item.brand || 'أخرى').trim().slice(0, 120),
    category: categoryIds.get(categoryName) || null,
    categoryName,
    price,
    salePrice: salePrice && salePrice < price ? salePrice : null,
    discountPct: salePrice && salePrice < price ? discount : 0,
    image,
    images: localGallery.length ? localGallery : gallery.length ? gallery : [image],
    inStock: item.in_stock !== false,
    isFeatured: false, // assigned deterministically after all docs are built
    description: String(
      item.description ||
        `${item.name} - منتج أصلي متوفر لدى مركز أبو ربيع للمعدات بضمان الجودة وأفضل سعر.`
    ).slice(0, 5000),
    specs: parseSpecs(item.specs),
    sortOrder: index,
  };

  // bulkWrite bypasses the pre('save') hook, so the slug has to be derived here
  // as well. Without it every product would be written without a slug and the
  // unique slug index would reject the second insert.
  doc.slug = buildSlug(doc);

  return doc;
};

/**
 * Chooses featured products deterministically: the highest discounts overall,
 * then enough top sellers per category to give the landing page a full strip.
 * The previous version used Math.random(), so every re-seed reshuffled which
 * products were featured.
 */
const assignFeatured = (docs) => {
  const FEATURED_MIN = 12;
  const PER_CATEGORY = 4;

  const ranked = [...docs].sort(
    (a, b) => b.discountPct - a.discountPct || a.sortOrder - b.sortOrder
  );

  const chosen = new Set();
  const perCategory = new Map();

  for (const doc of ranked) {
    if (chosen.size >= FEATURED_MIN) break;
    const seen = perCategory.get(doc.categoryName) || 0;
    if (seen >= PER_CATEGORY) continue;
    if (!doc.inStock) continue;
    chosen.add(doc.sourceId);
    perCategory.set(doc.categoryName, seen + 1);
  }

  for (const doc of docs) {
    doc.isFeatured = chosen.has(doc.sourceId);
  }

  return chosen.size;
};

const seedAdmin = async ({ say = console.log } = {}) => {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const email = (process.env.ADMIN_EMAIL || 'admin@aburabie.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  // Refuse to create the account with the documented default in production:
  // the admin panel is otherwise reachable with a password that is published
  // in this repository.
  if (process.env.NODE_ENV === 'production' && password === 'admin123') {
    throw new Error(
      'ADMIN_PASSWORD is still the default. Set a strong ADMIN_PASSWORD before seeding in production.'
    );
  }

  const existing = await Admin.findOne({
    $or: [{ username }, { email }],
  });

  if (existing) {
    say(`ℹ️  Admin account already exists: ${existing.username}`);
    return;
  }

  await Admin.create({
    username,
    email,
    password,
    name: 'م/ محمد أبو ربيع',
    role: 'superadmin',
  });

  say(`✅ Admin created -> ${username}`);
  if (password === 'admin123') {
    console.warn('⚠️  Using the default password. Change it before deploying.');
  }
};

const seedCategories = async ({ say = console.log } = {}) => {
  const categoryIds = new Map();

  for (const definition of [...CATEGORY_MAP, FALLBACK_CATEGORY]) {
    let category = await Category.findOne({ slug: definition.slug });
    if (!category) {
      category = await Category.create(definition);
    }
    categoryIds.set(category.name, category._id);
    categoryIds.set(definition.name, category._id);
  }

  say(`🏷️  Categories ready: ${categoryIds.size / 2}`);
  return categoryIds;
};

/**
 * Guarantees every slug in the batch is unique.
 *
 * Slugs are derived from the SKU when one exists, but the scraped feed repeats
 * some SKUs across different products (TH308268 appears twice), which would
 * trip the unique slug index and abort the whole import. Collisions fall back to
 * the sourceId, which is the stable per-row identifier.
 */
const dedupeSlugs = (docs) => {
  const taken = new Set();

  for (const doc of docs) {
    if (!taken.has(doc.slug)) {
      taken.add(doc.slug);
      continue;
    }

    const fallback = buildSlug({ sourceId: doc.sourceId });
    doc.slug = taken.has(fallback) ? `${fallback}-${doc.sortOrder}` : fallback;
    taken.add(doc.slug);
  }

  return docs;
};

const seedProducts = async (records, categoryIds, { silent = false } = {}) => {
  const docs = dedupeSlugs(
    records
      .map((item, index) => toProductDoc(item, index, categoryIds))
      .filter((doc) => doc.name && doc.price > 0)
  );

  const skipped = records.length - docs.length;
  const featuredCount = assignFeatured(docs);

  const BATCH_SIZE = 200;
  let upserted = 0;
  let created = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);

    const result = await Product.bulkWrite(
      batch.map((doc) => ({
        updateOne: {
          filter: { sourceId: doc.sourceId },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    upserted += result.upsertedCount || 0;
    created += result.modifiedCount || 0;

    if (!silent) {
      process.stdout.write(
        `\r   seeded ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}`
      );
    }
  }

  if (!silent) process.stdout.write('\n');

  return {
    attempted: records.length,
    imported: docs.length,
    skipped,
    featured: featuredCount,
    inserted: created + upserted,
    updated: docs.length - created - upserted,
  };
};

/**
 * Runs the import.
 *
 * Exported so the server can call it directly instead of shelling out. On a
 * fresh deployment the catalogue is empty until someone remembers to run
 * `npm run seed`, which means a live site showing no products.
 *
 *   reset   drop products and categories first
 *   silent  suppress the console output
 */
async function seedData({ reset = false, silent = false, log = console.log } = {}) {
  const say = (message) => {
    if (!silent) log(message);
  };

  const records = loadDataset({ say });

  say('👤 Checking admin account...');
  await seedAdmin({ say });

  say('🏷️  Seeding categories...');
  const categoryIds = await seedCategories({ say });

  if (!records.length) {
    say('⚠️  Nothing to seed. The catalogue will be empty.');
  }

  say('⚙️  Seeding products...');
  const summary = await seedProducts(records, categoryIds, { silent });

  await syncIndexes(mongoose, { silent: true });
  say('📇 Indexes ensured.');

  const [totalProducts, totalCategories] = await Promise.all([
    Product.countDocuments(),
    Category.countDocuments(),
  ]);

  const lines = [
    '',
    '=======================================',
    '🎉 SEEDING COMPLETE 🎉',
    `📊 Categories in DB:      ${totalCategories}`,
    `📦 Products in DB:        ${totalProducts}`,
    `   ├─ from dataset:       ${summary.imported}`,
    `   ├─ skipped (no name / price): ${summary.skipped}`,
    `   └─ featured:           ${summary.featured}`,
  ];

  if (!reset) {
    lines.push(`🔄 Upserted this run:     ${summary.inserted} written`);
  }

  lines.push('=======================================');
  lines.forEach(say);

  return { ...summary, totalProducts, totalCategories };
}

/**
 * Seeds only if the catalogue is empty.
 *
 * Used on boot so a brand new deployment is never empty. An existing catalogue
 * is left completely untouched, so this cannot overwrite real edits.
 */
async function seedIfEmpty() {
  const existing = await Product.countDocuments();
  if (existing > 0) return { seeded: false, existing };

  return { seeded: true, ...(await seedData()) };
}

/**
 * Connects, seeds, then exits. This is the `npm run seed` command.
 */
async function runCli() {
  const reset = process.argv.includes('--reset');

  try {
    if (!process.env.MONGODB_URI) {
      console.error('❌ MONGODB_URI is not set in backend/.env');
      process.exit(1);
    }

    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log(`✅ Connected to ${mongoose.connection.host}`);

    if (reset) {
      console.log('🗑️  --reset: dropping products and categories...');
      await Promise.all([Product.deleteMany({}), Category.deleteMany({})]);
    }

    await seedData({ reset });
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeder error:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  seedData,
  seedIfEmpty,
  seedAdmin,
  seedCategories,
  runCli,
  loadDataset,
  buildSlug,
};
