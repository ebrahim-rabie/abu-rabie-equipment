const MIN_SECRET_LENGTH = 32;

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Whether controllers may fall back to the local JSON store when MongoDB is
 * unreachable. Always false in production. Reads process.env directly so it is
 * safe to call from modules that load before getEnv().
 */
const offlineModeEnabled = () =>
  !isProduction() &&
  String(process.env.ALLOW_OFFLINE_MODE).toLowerCase() === 'true';

/**
 * Reads a required environment variable and refuses weak values in production.
 * Throws instead of falling back to a hardcoded literal, so a missing secret is a
 * loud boot failure rather than a silent security hole.
 */
const requireSecret = (name, { minLength = MIN_SECRET_LENGTH } = {}) => {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(
      `${name} is missing. Set it in backend/.env (see backend/.env.example).`
    );
  }

  if (isProduction()) {
    if (value.trim().length < minLength) {
      throw new Error(
        `${name} must be at least ${minLength} characters in production (got ${value.trim().length}).`
      );
    }
    if (value.includes('development') || value.includes('changeme') || value === 'admin123') {
      throw new Error(`${name} still holds a placeholder value. Generate a random secret.`);
    }
  }

  return value.trim();
};

/**
 * Reads a variable that must be present in production but may have a harmless
 * default while developing locally.
 */
const requireInProduction = (name, fallback) => {
  const value = process.env[name];

  if (value !== undefined && value !== '') return value;

  if (isProduction()) {
    throw new Error(`${name} is required when NODE_ENV=production.`);
  }

  return fallback;
};

const loadEnv = () => {
  const config = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: Number(process.env.PORT) || 5000,
    JWT_SECRET: requireSecret('JWT_SECRET'),
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    WHATSAPP_NUMBER: requireInProduction(
      'WHATSAPP_NUMBER',
      '201093044150'
    ),
    ADMIN_USERNAME: requireInProduction('ADMIN_USERNAME', 'admin'),
    ADMIN_EMAIL: requireInProduction('ADMIN_EMAIL', 'admin@aburabie.com'),
    // Offline JSON fallback is a local development convenience only. It must be
    // switched on explicitly and can never be active in production.
    ALLOW_OFFLINE_MODE: offlineModeEnabled(),
  };

  return config;
};

let cached = null;

const getEnv = () => {
  if (!cached) cached = loadEnv();
  return cached;
};

module.exports = {
  getEnv,
  requireSecret,
  requireInProduction,
  isProduction,
  offlineModeEnabled,
  MIN_SECRET_LENGTH,
};