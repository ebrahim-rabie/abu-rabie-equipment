const fs = require('fs');
const path = require('path');

/**
 * Local JSON fallback store — DEVELOPMENT ONLY.
 *
 * This module exists so the site can be run without a MongoDB instance. It is
 * unreachable in production: config/db.js terminates the process when the
 * database is unavailable, and config/env.js keeps ALLOW_OFFLINE_MODE false
 * outside development.
 *
 * Products come from the scraped dataset at the repository root. Administrative
 * edits are written to data/products.override.json so they survive a restart
 * instead of silently vanishing, which was the behaviour before this rewrite.
 */

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const ordersFile = path.join(dataDir, 'orders.json');
const contactsFile = path.join(dataDir, 'contacts.json');
const overridesFile = path.join(dataDir, 'products.override.json');

const DEFAULT_IMAGE = 'assets/logo.jpg';

// Read JSON file safely
function readJSON(file, defaultVal = []) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
  return defaultVal;
}

// Write JSON file safely
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${file}:`, err.message);
  }
}

const pipeline = (str) =>
  String(str || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The scraped `categories` field is a pipe-joined list whose last segment is
 * always the "add to cart" button label, not a category.
 */
const cleanCategories = (raw) =>
  pipeline(raw).filter(
    (s) => !s.includes('إضافة إلى السلة') && !s.toLowerCase().includes('add-to-cart')
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

const toProduct = (item, index) => {
  const price = Number(item.regular_price_egp) || 500;
  const salePrice = item.sale_price_egp ? Number(item.sale_price_egp) : null;
  const discount =
    item.discount_pct ||
    (salePrice && price > salePrice
      ? Math.round(((price - salePrice) / price) * 100)
      : 0);

  const [catName = 'معدات كهربائية'] = cleanCategories(item.categories);

  const images = pipeline(item.images).filter((u) => /^https?:\/\//.test(u));
  const image = item.image || images[0] || DEFAULT_IMAGE;

  return {
    _id: String(item.id || `prod-${index + 1}`),
    sourceId: item.id ? String(item.id) : undefined,
    name: item.name,
    slug: String(item.sku || item.id || `tool-${index + 1}`).toLowerCase(),
    sku: item.sku || '',
    brand: item.brand || 'أخرى',
    categoryName: catName,
    price,
    salePrice,
    discountPct: discount,
    image,
    images: images.length ? images : [image],
    inStock: item.in_stock !== false,
    isFeatured: discount > 15 || index < 6,
    description:
      item.description ||
      `${item.name} - منتج ومعدة أصلية متوفرة لدى مركز المهندس محمد أبو ربيع مع خدمات الصيانة وقطع الغيار.`,
    specs: parseSpecs(item.specs),
    createdAt: new Date().toISOString(),
  };
};

/** Load products from the scraped dataset in data/ at the repository root. */
function loadLocalProducts() {
  const possiblePaths = [
    path.join(__dirname, '../../data/elkhalily_products.json'),
    path.join(__dirname, '../elkhalily_products.json'),
    path.join(__dirname, 'elkhalily_products.json'),
  ];

  for (const p of possiblePaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!Array.isArray(raw)) continue;
      return raw.map(toProduct);
    } catch (e) {
      console.error(`Failed to load ${p}:`, e.message);
    }
  }
  return [];
}

let cachedProducts = loadLocalProducts();

// Apply persisted administrative edits over the freshly loaded dataset
const applyOverrides = (products) => {
  const overrides = readJSON(overridesFile, {});
  const deleted = new Set();
  const patched = products.map((product) => {
    const patch = overrides[String(product._id)];
    if (!patch) return product;
    if (patch.__deleted) {
      deleted.add(String(product._id));
      return null;
    }
    return { ...product, ...patch, _id: product._id, sourceId: product.sourceId };
  });

  const survivors = patched.filter(Boolean);
  const existingIds = new Set(survivors.map((p) => String(p._id)));

  // Products created through the admin panel have no dataset counterpart
  const added = Object.entries(overrides)
    .filter(([id, patch]) => !existingIds.has(id) && patch && !patch.__deleted)
    .map(([id, patch]) => ({ ...patch, _id: id }));

  return added.length ? [...added, ...survivors] : survivors;
};

const persistOverride = (id, patch) => {
  const overrides = readJSON(overridesFile, {});
  overrides[String(id)] = { ...(overrides[String(id)] || {}), ...patch };
  writeJSON(overridesFile, overrides);
};

cachedProducts = applyOverrides(cachedProducts);

const reload = () => {
  cachedProducts = applyOverrides(loadLocalProducts());
};

const offlineStore = {
  getProducts({ category, search, brand, inStock, sort, page = 1, limit = 24 }) {
    let result = [...cachedProducts];

    if (category && category !== 'all' && category !== 'الكل') {
      result = result.filter(
        (p) => p.categoryName === category || (p.category && p.category.name === category)
      );
    }

    if (brand && brand !== 'all') {
      result = result.filter(
        (p) => p.brand && p.brand.toLowerCase() === String(brand).toLowerCase()
      );
    }

    if (inStock !== undefined) {
      const isStock = inStock === 'true';
      result = result.filter((p) => p.inStock === isStock);
    }

    if (search && String(search).trim()) {
      const term = String(search).toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          (p.sku && p.sku.toLowerCase().includes(term)) ||
          (p.brand && p.brand.toLowerCase().includes(term)) ||
          (p.categoryName && p.categoryName.toLowerCase().includes(term))
      );
    }

    if (sort === 'price-asc') result.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
    else if (sort === 'discount') result.sort((a, b) => b.discountPct - a.discountPct);
    else if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const total = result.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
    const skip = (pageNum - 1) * limitNum;

    return {
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      brands: Array.from(new Set(cachedProducts.map((p) => p.brand).filter(Boolean))),
      products: result.slice(skip, skip + limitNum),
    };
  },

  /**
   * Minimal Product-shaped adapter so order.controller.priceItems() can price a
   * checkout against the offline catalogue exactly as it does against MongoDB.
   */
  asProductModel() {
    return {
      find: ({ _id: { $in: ids } } = {}) =>
        Promise.resolve(
          (ids || [])
            .map((id) => cachedProducts.find((p) => String(p._id) === String(id)))
            .filter(Boolean)
            .map((p) => ({
              _id: p._id,
              name: p.name,
              sku: p.sku,
              price: p.price,
              salePrice: p.salePrice,
              inStock: p.inStock,
              image: p.image,
            }))
        ),
    };
  },

  getProductBySlug(slug) {
    return cachedProducts.find(
      (p) => p.slug === slug || String(p._id) === String(slug)
    );
  },

  addProduct(prod) {
    const id = `prod-${Date.now()}`;
    const newProd = {
      _id: id,
      slug: String(prod.sku || `item-${Date.now()}`).toLowerCase(),
      ...prod,
      images: prod.images || (prod.image ? [prod.image] : [DEFAULT_IMAGE]),
      createdAt: new Date().toISOString(),
    };
    persistOverride(id, newProd);
    cachedProducts.unshift(newProd);
    return newProd;
  },

  updateProduct(id, updateData) {
    const idx = cachedProducts.findIndex((p) => String(p._id) === String(id));
    if (idx === -1) return null;
    persistOverride(id, updateData);
    cachedProducts[idx] = { ...cachedProducts[idx], ...updateData, _id: cachedProducts[idx]._id };
    return cachedProducts[idx];
  },

  deleteProduct(id) {
    const initial = cachedProducts.length;
    cachedProducts = cachedProducts.filter((p) => String(p._id) !== String(id));
    const removed = cachedProducts.length < initial;
    if (removed) persistOverride(String(id), { __deleted: true });
    return removed;
  },

  getCategories() {
    const catMap = new Map();
    cachedProducts.forEach((p) => {
      const name = p.categoryName || 'معدات عامة';
      catMap.set(name, (catMap.get(name) || 0) + 1);
    });

    return Array.from(catMap.entries()).map(([name, count], idx) => ({
      _id: `cat-${idx + 1}`,
      name,
      slug: `cat-${idx + 1}`,
      productCount: count,
      isActive: true,
    }));
  },

  getOrders() {
    return readJSON(ordersFile);
  },

  saveOrder(order) {
    const orders = readJSON(ordersFile);
    orders.unshift(order);
    writeJSON(ordersFile, orders);
    return order;
  },

  updateOrderStatus(orderId, status) {
    const orders = readJSON(ordersFile);
    const ord = orders.find((o) => o._id === orderId || o.orderNumber === orderId);
    if (ord) {
      ord.status = status;
      writeJSON(ordersFile, orders);
      return ord;
    }
    return null;
  },

  deleteOrder(orderId) {
    const orders = readJSON(ordersFile);
    const remaining = orders.filter((o) => o._id !== orderId && o.orderNumber !== orderId);
    const removed = remaining.length < orders.length;
    if (removed) writeJSON(ordersFile, remaining);
    return removed;
  },

  getContacts() {
    return readJSON(contactsFile);
  },

  saveContact(contact) {
    const contacts = readJSON(contactsFile);
    contacts.unshift(contact);
    writeJSON(contactsFile, contacts);
    return contact;
  },

  markContactRead(id) {
    const contacts = readJSON(contactsFile);
    const c = contacts.find((item) => item._id === id);
    if (c) {
      c.isRead = true;
      writeJSON(contactsFile, contacts);
      return c;
    }
    return null;
  },

  reload,
};

module.exports = offlineStore;