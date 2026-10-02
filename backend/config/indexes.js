/**
 * Database index definitions.
 *
 * Called automatically after a successful connection (see config/db.js) and
 * available standalone via `npm run indexes`.
 *
 * The catalog text index is the important one: it turns the Arabic/Latin product
 * search from a full collection regex scan into an indexed lookup.
 */

const buildIndexSpecs = () => {
  return {
    Product: [
      { keys: { slug: 1 }, options: { unique: true } },
      {
        keys: { sku: 1 },
        options: {
          // Deliberately NOT unique. The scraped feed reuses SKUs across
          // different products (e.g. "TH308268 +"), so a unique index here
          // aborts the whole import. Uniqueness is enforced on sourceId and
          // slug, which are the real identities; sku is a lookup key.
          name: 'sku_lookup',
        },
      },
      {
        keys: { sourceId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { sourceId: { $type: 'string', $gt: '' } },
        },
      },
      {
        keys: {
          name: 'text',
          sku: 'text',
          brand: 'text',
          categoryName: 'text',
          description: 'text',
        },
        options: {
          name: 'product_search',
          weights: { name: 10, sku: 8, brand: 5, categoryName: 3, description: 1 },
        },
      },
      { keys: { category: 1, inStock: 1, sortOrder: 1 }, options: { name: 'category_stock' } },
      { keys: { brand: 1 }, options: { name: 'brand' } },
      { keys: { price: 1 }, options: { name: 'price' } },
      { keys: { discountPct: -1 }, options: { name: 'discount' } },
      { keys: { isFeatured: 1, createdAt: -1 }, options: { name: 'featured' } },
    ],
    Order: [
      { keys: { orderNumber: 1 }, options: { unique: true } },
      { keys: { customerPhone: 1 }, options: { name: 'customer_phone' } },
      { keys: { user: 1, createdAt: -1 }, options: { name: 'customer_orders' } },
      { keys: { createdAt: -1 }, options: { name: 'recent' } },
      { keys: { status: 1, createdAt: -1 }, options: { name: 'status_recent' } },
    ],
    Category: [{ keys: { slug: 1 }, options: { unique: true } }],
    Contact: [
      { keys: { createdAt: -1 }, options: { name: 'recent' } },
      { keys: { isRead: 1, createdAt: -1 }, options: { name: 'unread' } },
    ],
  };
};

/**
 * Resolves every model by name.
 *
 * The models are required here rather than read off `mongoose.model(name)` so
 * this works no matter who calls it. `npm run seed` only imports Product,
 * Category and Admin, so resolving through the registry alone would fail with
 * MissingSchemaError for Order and Contact.
 */
const resolveModels = (mongoose) => ({
  Product: require('../models/Product'),
  Order: require('../models/Order'),
  Category: require('../models/Category'),
  Contact: require('../models/Contact'),
});

/**
 * Creates every index, reporting each one. Safe to run repeatedly: existing
 * indexes with matching definitions are left untouched.
 */
const syncIndexes = async (mongoose, { silent = false } = {}) => {
  const models = resolveModels(mongoose);

  const specs = buildIndexSpecs();
  const summary = {};

  for (const [modelName, indexes] of Object.entries(specs)) {
    summary[modelName] = [];
    for (const { keys, options } of indexes) {
      const name =
        options.name ||
        Object.keys(keys)
          .map((k) => `${k}_${keys[k]}`)
          .join('_');
      try {
        await models[modelName].collection.createIndex(keys, options);
        summary[modelName].push(name);
        if (!silent) console.log(`  ✔ ${modelName}.${name}`);
      } catch (error) {
        summary[modelName].push(`${name} (FAILED: ${error.message})`);
        if (!silent) console.error(`  ✖ ${modelName}.${name}: ${error.message}`);
      }
    }
  }

  return summary;
};

/**
 * Standalone entry point for `npm run indexes`.
 *
 * createIndex is idempotent, so this is safe to run against an existing
 * database. Exits non-zero if any index failed, because a silently missing
 * unique constraint is exactly the kind of thing that must not ship.
 */
const runStandalone = async () => {
  const path = require('path');
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env') });

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set. Add it to backend/.env first.');
    process.exit(1);
  }

  const mongoose = require('mongoose');

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log(`✅ Connected to ${mongoose.connection.host}`);
    console.log('📇 Creating indexes...\n');

    const summary = await syncIndexes(mongoose);

    const failures = Object.values(summary)
      .flat()
      .filter((entry) => entry.includes('FAILED'));

    console.log('\n=======================================');
    if (failures.length) {
      console.error(`✖ ${failures.length} index(es) failed:`);
      failures.forEach((f) => console.error(`   - ${f}`));
      console.log('=======================================\n');
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log('🎉 ALL INDEXES READY 🎉');
    console.log('=======================================\n');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Index build failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

if (require.main === module) {
  runStandalone();
}

module.exports = { syncIndexes, buildIndexSpecs, runStandalone };