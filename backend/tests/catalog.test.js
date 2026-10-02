const test = require('node:test');
const assert = require('node:assert/strict');

const { startHarness, clearDatabase } = require('./harness');
const Product = require('../models/Product');
const Category = require('../models/Category');

/**
 * Contract tests for catalogue browsing.
 *
 * The storefront now paginates and filters through the API instead of pulling
 * the whole catalogue into the browser, so these assertions pin the response
 * shape the frontend depends on.
 */

const TOTAL = 130;
const PER_PAGE = 24;

let h;
let categoryId;

const makeProduct = (index) => ({
  name: `منتج تجريبي ${index}`,
  // insertMany skips the pre('save') hook, so the slug has to be supplied here
  // exactly as the seeder does. Without it the unique slug index rejects the
  // insert, which is the whole point of that index.
  slug: `catalog-${index}`,
  sourceId: `catalog-${index}`,
  sku: `SKU-${index}`,
  brand: index % 2 === 0 ? 'ماركة أ' : 'ماركة ب',
  category: categoryId,
  categoryName: 'معدات كهربائية',
  price: 100 + index,
  salePrice: index % 5 === 0 ? 50 + index : null,
  discountPct: index % 5 === 0 ? 50 : 0,
  image: 'https://example.test/p.jpg',
  images: ['https://example.test/p.jpg'],
  inStock: index !== 7,
  isFeatured: index < 4,
  sortOrder: index,
});

test.before(async () => {
  h = await startHarness();
  await clearDatabase();

  const category = await Category.create({
    name: 'معدات كهربائية',
    slug: 'power-tools',
    description: 'test',
    isActive: true,
  });
  categoryId = category._id;

  // Seed past a single page so pagination has something to page through
  await Product.insertMany(Array.from({ length: TOTAL }, (_, i) => makeProduct(i)));
});

test.after(async () => {
  if (h) await h.stop();
});

test('page 1 returns the requested window and the real total', async () => {
  const res = await h.request(`/api/products?page=1&limit=${PER_PAGE}`);
  assert.equal(res.status, 200);

  assert.equal(res.body.total, TOTAL, 'total must reflect the whole catalogue');
  assert.equal(res.body.data.length, PER_PAGE);
  assert.equal(res.body.currentPage, 1);
  assert.equal(res.body.totalPages, Math.ceil(TOTAL / PER_PAGE));
  assert.equal(res.body.count, PER_PAGE);
});

test('every product in the catalogue is reachable by paging', async () => {
  const seen = new Set();
  let page = 1;
  let totalPages = 1;

  do {
    const res = await h.request(`/api/products?page=${page}&limit=${PER_PAGE}`);
    assert.equal(res.status, 200);
    totalPages = res.body.totalPages;
    res.body.data.forEach((p) => seen.add(p._id));
    page += 1;
  } while (page <= totalPages);

  assert.equal(
    seen.size,
    TOTAL,
    'paging through the catalogue must expose every product, not just the first page'
  );
});

test('pages do not overlap', async () => {
  const first = await h.request('/api/products?page=1&limit=10');
  const second = await h.request('/api/products?page=2&limit=10');

  const firstIds = new Set(first.body.data.map((p) => p._id));
  const overlapping = second.body.data.filter((p) => firstIds.has(p._id));

  assert.equal(overlapping.length, 0, 'skip/limit overlap would duplicate or drop products');
});

test('a page past the end returns an empty set, not an error', async () => {
  const res = await h.request('/api/products?page=999&limit=24');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.total, TOTAL, 'the total stays accurate even on an empty page');
});

test('search covers products that are not on page 1', async () => {
  // This is the bug the client-side filter had: it only ever searched the first
  // 100 products it had downloaded.
  const target = makeProduct(TOTAL - 1);
  await Product.findOneAndUpdate({ sourceId: target.sourceId }, { name: 'مطرقة نادرة جدا' });

  const res = await h.request('/api/products?search=' + encodeURIComponent('نادرة جدا'));
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 1, 'a product on the last page must be findable');
  assert.equal(res.body.data[0].name, 'مطرقة نادرة جدا');
});

test('search treats the query as text, not a pattern', async () => {
  const res = await h.request('/api/products?search=' + encodeURIComponent('.*'));
  assert.equal(res.status, 200);
  assert.equal(
    res.body.total,
    0,
    'an unescaped regex from the client must not match every document'
  );
});

test('the category filter narrows the catalogue and reports brands', async () => {
  const res = await h.request('/api/products?category=power-tools&limit=50');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, TOTAL);
  assert.ok(res.body.brands.includes('ماركة أ'));
  assert.ok(res.body.brands.includes('ماركة ب'));
});

test('an unknown category returns nothing rather than everything', async () => {
  const res = await h.request('/api/products?category=does-not-exist');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0);
});

test('sorting by price really orders by price', async () => {
  const res = await h.request('/api/products?sort=price-asc&limit=50');
  const prices = res.body.data.map((p) => p.price);

  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test('sorting by discount puts the biggest saving first', async () => {
  const res = await h.request('/api/products?sort=discount&limit=10');
  const discounts = res.body.data.map((p) => p.discountPct || 0);

  assert.ok(discounts[0] > 0, 'discount sort should surface discounted products');
  assert.deepEqual(discounts, [...discounts].sort((a, b) => b - a));
});

test('the featured strip excludes out-of-stock products', async () => {
  await Product.updateOne({ sortOrder: 7 }, { inStock: false, isFeatured: true });

  const res = await h.request('/api/products/featured?limit=12');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.every((p) => p.inStock === true));
});

test('categories report how many products each one holds', async () => {
  const res = await h.request('/api/categories');
  assert.equal(res.status, 200);

  const found = res.body.data.find((c) => c.slug === 'power-tools');
  assert.ok(found);
  assert.equal(found.productCount, TOTAL);
});