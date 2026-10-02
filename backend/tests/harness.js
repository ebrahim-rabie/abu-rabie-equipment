/**
 * Test harness: boots an in-memory MongoDB, seeds a known catalogue, and
 * starts the Express app on an ephemeral port.
 *
 * Using the built-in node:test runner keeps the project dependency-free; the
 * only addition is mongodb-memory-server, a devDependency that downloads a
 * real mongod binary so the MongoDB code paths are genuinely exercised rather
 * than mocked.
 */
const path = require('path');
const fs = require('fs');

// Must be set before any application module reads them
const TEST_JWT_SECRET = 'test_only_secret_that_is_definitely_long_enough_32';
const MONGO_ROOT = path.join(__dirname, '..', 'node_modules', '.cache', 'mongodb-binaries');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.JWT_EXPIRES_IN = '1h';
process.env.WHATSAPP_NUMBER = '201093044150';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_EMAIL = 'testadmin@aburabie.test';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.CLIENT_URL = 'https://shop.example.test';
process.env.ALLOW_OFFLINE_MODE = 'false';
delete process.env.MONGODB_URI;

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const startHarness = async () => {
  const mongod = await MongoMemoryServer.create({
    binary: {
      version: '7.0.14',
      downloadDir: fs.existsSync(MONGO_ROOT) ? MONGO_ROOT : undefined,
    },
  });

  const uri = mongod.getUri('abu_rabie_test');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  // Require the app only after the environment is fully prepared
  const app = require('../app');

  // Build the real indexes so uniqueness constraints behave as they do in
  // production (unique slug, unique sourceId, unique phone).
  const { syncIndexes } = require('../config/indexes');
  await syncIndexes(mongoose, { silent: true });

  // Guarantee the unique phone index exists for the User model too
  const User = require('../models/User');
  await User.collection.createIndex({ phone: 1 }, { unique: true });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (pathname, { method = 'GET', body, token, origin, headers = {} } = {}) => {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return { status: res.status, body: json, text, headers: res.headers };
  };

  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongod.stop();
  };

  // Exposed so a test can point a spawned child process (e.g. the seeder
  // script, which calls process.exit and cannot share this connection)
  // at the same in-memory database.
  return { app, baseUrl, request, stop, mongoose, uri };
};

/** Wipes every collection between test groups. */
const clearDatabase = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
};

module.exports = { startHarness, clearDatabase, TEST_JWT_SECRET };