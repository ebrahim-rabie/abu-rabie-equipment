const mongoose = require('mongoose');
const { syncIndexes } = require('./indexes');

const connectOptions = {
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 10,
  retryWrites: true,
};

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set. Configure it in backend/.env.');
    return failToStart('MONGODB_URI missing');
  }

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, connectOptions);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    console.log('📇 Ensuring indexes...');
    await syncIndexes(mongoose);
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    return failToStart(error.message);
  }
};

const failToStart = (reason) => {
  // The offline JSON fallback exists purely as a local development convenience.
  // It is never available in production, so a missing database is a hard boot
  // failure there rather than a silent downgrade to an unauthenticated store.
  if (process.env.NODE_ENV === 'production') {
    console.error('🛑 Refusing to start: production requires a working MONGODB_URI.');
    process.exit(1);
  }

  if (String(process.env.ALLOW_OFFLINE_MODE).toLowerCase() !== 'true') {
    console.warn(
      '⚠️  Running without a database. Set ALLOW_OFFLINE_MODE=true to enable the local JSON fallback (development only).'
    );
  }

  console.warn(`   Reason: ${reason}`);
  return null;
};

module.exports = connectDB;