// Guards on config/env.js. These are the last thing standing between a
// misconfigured deploy and a publicly reachable site, so every rule the README
// promises is asserted here rather than left to inspection.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const mongoose = require('mongoose');

// Loading a model pulls in config/env.js, which demands a secret. This file
// tests env.js itself, so it supplies a throwaway value up front and never
// relies on the harness.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'k'.repeat(48);
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.WHATSAPP_NUMBER = '201093044150';

const ENV_PATH = path.join(__dirname, '..', 'config', 'env.js');

/**
 * Re-requires config/env.js with a clean cache so the memoised config cannot
 * leak between cases.
 */
const loadEnv = () => {
  delete require.cache[require.resolve(ENV_PATH)];
  return require(ENV_PATH);
};

/**
 * Runs `fn` with the given environment, restoring whatever was there before.
 */
const withEnv = (vars, fn) => {
  const before = {};
  for (const key of Object.keys(vars)) before[key] = process.env[key];

  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return fn(loadEnv());
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve(ENV_PATH)];
  }
};

const LONG_SECRET = 'k'.repeat(48);

/**
 * A complete production environment. getEnv() validates the whole set at once,
 * so any case that switches NODE_ENV to production must supply all of it,
 * otherwise the failure comes from an unrelated missing variable.
 */
const productionEnv = (overrides = {}) => ({
  NODE_ENV: 'production',
  JWT_SECRET: LONG_SECRET,
  WHATSAPP_NUMBER: '201093044150',
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@aburabie.com',
  ADMIN_PASSWORD: 'a-strong-passphrase',
  ALLOW_OFFLINE_MODE: undefined,
  ...overrides,
});

// One in-memory server for the whole file: only the admin-seed guard needs a
// database, to prove a refused seed leaves no row behind.
let mongod;

test.before(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri('abu_rabie_env'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// ---------------------------------------------------------------------------
// requireSecret
// ---------------------------------------------------------------------------

test('requireSecret refuses to invent a value', () => {
  withEnv({ JWT_SECRET: undefined }, ({ requireSecret }) => {
    assert.throws(() => requireSecret('JWT_SECRET'), /JWT_SECRET is missing/);
  });
});

test('requireSecret rejects a short secret only in production', () => {
  withEnv({ NODE_ENV: 'development', JWT_SECRET: 'short' }, ({ requireSecret }) => {
    // Tolerated locally so a quick `npm start` does not need ceremony.
    assert.equal(requireSecret('JWT_SECRET'), 'short');
  });

  withEnv({ NODE_ENV: 'production', JWT_SECRET: 'short' }, ({ requireSecret }) => {
    assert.throws(() => requireSecret('JWT_SECRET'), /at least 32 characters/);
  });
});

test('requireSecret rejects published placeholders in production', () => {
  const placeholders = [
    'a-development-value-that-is-long-enough-32',
    'please-changeme-this-value-is-long-enough-32',
    'admin123',
  ];

  for (const value of placeholders) {
    withEnv({ NODE_ENV: 'production', JWT_SECRET: value }, ({ requireSecret }) => {
      assert.throws(() => requireSecret('JWT_SECRET'), /placeholder|32 characters/);
    });
  }
});

test('requireSecret accepts a strong production secret', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: LONG_SECRET }, ({ requireSecret }) => {
    assert.equal(requireSecret('JWT_SECRET'), LONG_SECRET);
  });
});

// ---------------------------------------------------------------------------
// requireInProduction
// ---------------------------------------------------------------------------

test('requireInProduction demands a real value on a live server', () => {
  withEnv({ NODE_ENV: 'production', WHATSAPP_NUMBER: undefined }, (env) => {
    assert.throws(
      () => env.requireInProduction('WHATSAPP_NUMBER', '201093044150'),
      /WHATSAPP_NUMBER is required/
    );
  });

  withEnv({ NODE_ENV: 'development', WHATSAPP_NUMBER: undefined }, (env) => {
    assert.equal(env.requireInProduction('WHATSAPP_NUMBER', '201093044150'), '201093044150');
  });
});

// ---------------------------------------------------------------------------
// Offline mode
// ---------------------------------------------------------------------------

test('offline mode can never be switched on in production', () => {
  // This is the single most dangerous setting in the file: it lets controllers
  // serve stale JSON instead of failing loudly.
  withEnv(productionEnv({ ALLOW_OFFLINE_MODE: 'true' }), (env) => {
    assert.equal(env.offlineModeEnabled(), false);
    assert.equal(env.getEnv().ALLOW_OFFLINE_MODE, false);
  });
});

test('offline mode is opt-in outside production', () => {
  withEnv({ NODE_ENV: 'development', ALLOW_OFFLINE_MODE: 'true' }, (env) => {
    assert.equal(env.offlineModeEnabled(), true);
  });

  withEnv({ NODE_ENV: 'development', ALLOW_OFFLINE_MODE: undefined }, (env) => {
    assert.equal(env.offlineModeEnabled(), false);
  });
});

// ---------------------------------------------------------------------------
// Seeder admin password
// ---------------------------------------------------------------------------

test('the seeder refuses to create the admin with the documented default', async () => {
  const { seedAdmin } = require('../utils/seeder');
  const Admin = require('../models/Admin'); // exports the model itself

  await Admin.deleteMany({});

  // Every value getEnv() demands in production, so the refusal under test is
  // the ADMIN_PASSWORD rule and not an unrelated missing variable.
  const productionEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: LONG_SECRET,
    WHATSAPP_NUMBER: '201093044150',
    ADMIN_USERNAME: 'admin',
    ADMIN_EMAIL: 'admin@aburabie.com',
    ADMIN_PASSWORD: 'admin123',
    ALLOW_OFFLINE_MODE: undefined,
  };

  await withEnv(productionEnv, async () => {
    await assert.rejects(
      () => seedAdmin({ say: () => {} }),
      /ADMIN_PASSWORD is still the default/
    );
  });

  const count = await Admin.countDocuments({});
  assert.equal(count, 0, 'no admin row may exist after a refused seed');

  // The same seed succeeds once a real password is supplied.
  await withEnv({ ...productionEnv, ADMIN_PASSWORD: 'a-strong-passphrase' }, async () => {
    await seedAdmin({ say: () => {} });
  });

  assert.equal(await Admin.countDocuments({ username: 'admin' }), 1);
});

// ---------------------------------------------------------------------------
// Full config load
// ---------------------------------------------------------------------------

test('a production config loads with sane defaults', () => {
  withEnv(productionEnv({ ALLOW_OFFLINE_MODE: 'true', PORT: undefined }), (env) => {
    const config = env.getEnv();
    assert.equal(config.NODE_ENV, 'production');
    assert.equal(config.PORT, 5000);
    assert.equal(config.WHATSAPP_NUMBER, '201093044150');
    assert.equal(config.ADMIN_USERNAME, 'admin');
    assert.equal(config.ALLOW_OFFLINE_MODE, false);
  });
});