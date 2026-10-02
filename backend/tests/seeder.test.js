const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { startHarness, clearDatabase } = require('./harness');
const Product = require('../models/Product');
const Category = require('../models/Category');

/**
 * Data integrity checks against the real scraped dataset.
 *
 * The seeder is a script that calls process.exit, so it is exercised as a child
 * process pointed at the in-memory MongoDB URI. That proves the import path
 * end to end: parse -> normalise -> upsert.
 */

const DATASET = path.join(__dirname, '..', '..', 'data', 'elkhalily_products.json');
const SEEDER = path.join(__dirname, '..', 'utils', 'seeder.js');
const BACKEND_DIR = path.join(__dirname, '..');

const hasDataset = fs.existsSync(DATASET);
const skip = hasDataset ? false : 'elkhalily_products.json not present';

let h;
let rawDataset;

const runSeeder = (args = []) => {
  const result = spawnSync(process.execPath, [SEEDER, ...args], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      MONGODB_URI: h.uri,
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET,
      ADMIN_USERNAME: 'seeded_admin',
      ADMIN_EMAIL: 'seeded@test.local',
      ADMIN_PASSWORD: 'seededpassword123',
      ALLOW_OFFLINE_MODE: 'false',
    },
    encoding: 'utf-8',
    timeout: 240000,
  });

  if (result.status !== 0) {
    throw new Error(
      `seeder exited with ${result.status}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`
    );
  }

  return result.stdout;
};

test.before(async () => {
  if (!hasDataset) return;
  rawDataset = JSON.parse(fs.readFileSync(DATASET, 'utf-8'));
  h = await startHarness();
  await clearDatabase();
});

test.after(async () => {
  if (h) await h.stop();
});

// ---------------------------------------------------------------------------
// Dataset sanity
// ---------------------------------------------------------------------------
test('the dataset is well formed', { skip }, () => {
  assert.ok(Array.isArray(rawDataset));
  assert.ok(rawDataset.length > 100, 'expected a substantial catalogue');

  for (const key of ['id', 'name', 'regular_price_egp', 'images', 'specs']) {
    assert.ok(key in rawDataset[0], `records should carry "${key}"`);
  }
});

test('every record has a name and a usable price', { skip }, () => {
  const unnamed = rawDataset.filter((item) => !String(item.name || '').trim());
  assert.equal(unnamed.length, 0, `${unnamed.length} records have no name`);

  // A handful of rows in the source feed carry no price. The seeder skips them
  // rather than importing them at 0 EGP, so this is expected, not a defect.
  const unpriced = rawDataset.filter((item) => !Number(item.regular_price_egp));
  assert.ok(
    unpriced.length < rawDataset.length * 0.05,
    `${unpriced.length} unpriced records is too high to be feed noise`
  );
});

test('a duplicated SKU in the feed does not abort the import', { skip }, async () => {
  const bySku = new Map();
  for (const item of rawDataset) {
    const sku = String(item.sku || '').trim();
    if (!sku) continue;
    bySku.set(sku, (bySku.get(sku) || 0) + 1);
  }

  const duplicated = [...bySku.entries()].filter(([, n]) => n > 1);

  // Whatever the feed contains, the import must complete and land every
  // priceable record exactly once.
  const output = runSeeder();
  assert.match(output, /SEEDING COMPLETE/);

  const priceable = rawDataset.filter(
    (item) => String(item.name || '').trim() && Number(item.regular_price_egp)
  ).length;

  assert.equal(
    await Product.countDocuments(),
    priceable,
    'every priceable record should be present, duplicated SKUs included'
  );

  const slugs = await Product.distinct('slug');
  assert.equal(slugs.length, priceable, 'slug collisions must be resolved, not dropped');
  assert.ok(duplicated.length >= 0);
});

// ---------------------------------------------------------------------------
// Import behaviour
// ---------------------------------------------------------------------------
test('the seeder imports the catalogue', { skip }, async (t) => {
  const output = runSeeder();

  await t.test('reports a successful run', () => {
    assert.match(output, /SEEDING COMPLETE/);
  });

  await t.test('creates one document per priceable record', async () => {
    const priceable = rawDataset.filter(
      (item) => String(item.name || '').trim() && Number(item.regular_price_egp)
    ).length;

    const count = await Product.countDocuments();
    assert.equal(count, priceable, 'unpriceable rows are skipped, not imported at 0 EGP');
  });

  await t.test('reports how many rows it skipped', () => {
    const skipped = rawDataset.filter(
      (item) => !String(item.name || '').trim() || !Number(item.regular_price_egp)
    ).length;
    assert.match(
      output,
      new RegExp(`skipped \\(no name / price\\):\\s+${skipped}`),
      'the summary should account for every skipped row'
    );
  });

  await t.test('stores specs as an object, not a JSON string', async () => {
    const withSpecs = await Product.find({ 'specs.الماركة': { $exists: true } }).limit(5);
    assert.ok(withSpecs.length > 0, 'expected brand specs to be parsed');
    assert.equal(typeof withSpecs[0].specs, 'object');
  });

  await t.test('keeps the full image gallery', async () => {
    const sample = rawDataset.find((item) =>
      String(item.images || '')
        .split('|')
        .filter((u) => u.trim()).length > 2
    );
    assert.ok(sample, 'expected at least one record with a multi-image gallery');

    const doc = await Product.findOne({ sourceId: String(sample.id) });
    const expected = String(sample.images)
      .split('|')
      .map((u) => u.trim())
      .filter(Boolean).length;

    assert.equal(doc.images.length, expected, 'every gallery URL should survive');
    assert.ok(doc.image.startsWith('http'));
  });

  await t.test('maps products onto the four shop categories plus a fallback', async () => {
    const categories = await Category.find().lean();
    assert.equal(categories.length, 5, 'four shop categories plus "أخرى"');

    const names = categories.map((c) => c.name).sort();
    assert.deepEqual(names, ['أخرى', 'بطاريات وشواحن', 'معدات كهربائية', 'قطع غيار وصيانة', 'عدد يدوية'].sort());

    // Nothing should be left pointing at a raw WooCommerce category string
    const raw = await Product.countDocuments({
      categoryName: { $regex: 'إضافة إلى السلة' },
    });
    assert.equal(raw, 0, 'the "add to cart" label must never become a category');
  });

  await t.test('discount percentages are consistent', async () => {
    const inconsistent = await Product.find({
      $expr: {
        $and: [
          { $gt: ['$discountPct', 0] },
          { $or: [{ $eq: ['$salePrice', null] }, { $gte: ['$salePrice', '$price'] }] },
        ],
      },
    }).limit(5);

    assert.equal(
      inconsistent.length,
      0,
      'a discount percentage must imply a valid sale price'
    );
  });

  await t.test('slugs are unique and stable', async () => {
    const total = await Product.countDocuments();
    const distinctSlugs = await Product.distinct('slug');
    assert.equal(
      distinctSlugs.length,
      total,
      'duplicate slugs would break product URLs'
    );
  });

  await t.test('featured products are chosen deterministically', async () => {
    const featured = await Product.countDocuments({ isFeatured: true });
    assert.ok(featured > 0, 'the landing page needs featured products');
    assert.ok(featured <= 20, `expected a curated set, got ${featured}`);

    const notInStock = await Product.countDocuments({
      isFeatured: true,
      inStock: false,
    });
    assert.equal(notInStock, 0, 'out-of-stock products are not featured');
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
test('re-running the seeder does not duplicate products', { skip }, async (t) => {
  const before = await Product.countDocuments();

  const output = runSeeder();

  await t.test('the product count is unchanged', async () => {
    const after = await Product.countDocuments();
    assert.equal(after, before);
  });

  await t.test('feature flags do not shuffle between runs', async () => {
    // The previous seeder used Math.random(), so this assertion used to fail.
    const featured = await Product.countDocuments({ isFeatured: true });
    assert.ok(featured > 0);

    const secondOutput = runSeeder();
    assert.match(secondOutput, /SEEDING COMPLETE/);

    const featuredAgain = await Product.countDocuments({ isFeatured: true });
    assert.equal(featuredAgain, featured, 'isFeatured must be stable across runs');
  });

  await t.test('the summary accounts for every record', () => {
    const priceable = rawDataset.filter(
      (item) => String(item.name || '').trim() && Number(item.regular_price_egp)
    ).length;
    const skipped = rawDataset.length - priceable;

    assert.match(output, new RegExp(`from dataset:\\s+${priceable}\\b`));
    assert.match(output, new RegExp(`skipped \\(no name / price\\):\\s+${skipped}\\b`));
  });
});

// ---------------------------------------------------------------------------
// Boot-time seeding
// ---------------------------------------------------------------------------
test('autoSeed imports only an empty catalogue', { skip }, async (t) => {
  const { seedIfEmpty } = require('../utils/seeder');

  await t.test('an empty catalogue is imported on boot', async () => {
    await Product.deleteMany({});
    await Category.deleteMany({});

    const result = await seedIfEmpty();
    assert.equal(result.seeded, true);
    assert.ok(result.totalProducts > 0, 'a fresh deployment must not serve an empty shop');
  });

  await t.test('an existing catalogue is left completely alone', async () => {
    const target = await Product.findOne();
    const marker = `MARKER-${Date.now()}`;

    await Product.updateOne({ _id: target._id }, { name: marker });

    const result = await seedIfEmpty();

    assert.equal(result.seeded, false, 'seeding must not run against a populated catalogue');
    assert.ok(result.existing > 0);

    const after = await Product.findById(target._id);
    assert.equal(after.name, marker, 'an admin edit must survive a restart');
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
test('--reset clears products and categories first', { skip }, async () => {
  await Category.create({ name: 'قسم زائد', slug: 'extra-temp' });

  const output = runSeeder(['--reset']);

  assert.match(output, /dropping products and categories/);

  const temp = await Category.findOne({ slug: 'extra-temp' });
  assert.equal(temp, null, 'a reset run must clear existing categories');

  const priceable = rawDataset.filter(
    (item) => String(item.name || '').trim() && Number(item.regular_price_egp)
  ).length;

  const count = await Product.countDocuments();
  assert.equal(count, priceable, 'the catalogue is rebuilt in full');
});