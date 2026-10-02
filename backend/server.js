const dotenv = require('dotenv');

// Load environment variables before anything reads them
dotenv.config();

const { getEnv, isProduction } = require('./config/env');
const connectDB = require('./config/db');
const { isDbConnected } = require('./utils/dbState');

const app = require('./app');

/**
 * Imports the catalogue when the database is completely empty.
 *
 * On a first deployment there is nothing in Mongo yet, so without this the site
 * comes up serving zero products. An existing catalogue is never touched, so
 * this cannot overwrite edits made through the admin panel.
 */
async function autoSeed() {
  if (!isDbConnected()) return;

  try {
    const { seedIfEmpty } = require('./utils/seeder');
    const result = await seedIfEmpty();

    if (result.seeded) {
      console.log(`🌱 Catalogue was empty, imported ${result.totalProducts} products.`);
    } else {
      console.log(`📦 Catalogue already populated (${result.existing} products).`);
    }
  } catch (error) {
    // A failed import must not stop the server: the site can still be repaired
    // with `npm run seed` from a shell.
    console.error('⚠️  Automatic seeding failed:', error.message);
  }
}

async function start() {
  const env = getEnv();

  // A database outage terminates the process in production (see config/db.js);
  // in development the server still starts so the offline fallback can answer.
  await connectDB();
  await autoSeed();

  const port = env.PORT;

  const server = app.listen(port, () => {
    console.log(`
🚀 ===============================================
   مركز أبو ربيع للمعدات - الخادم الخلفي (Backend API)
   📡 Server Running on: http://localhost:${port}
   📂 Environment: ${env.NODE_ENV}
   🔍 Health Check: http://localhost:${port}/api/health
   🛍️ Products API: http://localhost:${port}/api/products
=================================================
  `);
  });

  // Fail fast on a port already in use rather than crashing silently
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use.`);
      process.exit(1);
    }
    throw error;
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(() => {
      require('mongoose').connection.close(false).then(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    console.error(`❌ Unhandled Error: ${err.message}`);
  });

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error('❌ Failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = { app, start, autoSeed };
module.exports.isProduction = isProduction;