const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Load environment variables before anything reads them
dotenv.config();

const { getEnv, isProduction } = require('./config/env');
const env = getEnv();

const { apiLimiter } = require('./middleware/rateLimit.middleware');

const app = express();

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: false, // Allows cross-origin image requests
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The storefront and the admin dashboard both load external scripts
        // from this CDN. Inline scripts are deliberately NOT allowed, which is
        // why the admin logic lives in admin/admin.js.
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        // 'unsafe-inline' is still needed for styles because the markup uses
        // style="" attributes throughout.
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // Every scraped product image is hotlinked from the supplier
        // catalogue until it is self-hosted.
        imgSrc: ["'self'", 'data:', 'https://elkhalily.com', 'https://www.elkhalily.com'],
        connectSrc: ["'self'", 'http://localhost:5000', 'http://127.0.0.1:5000'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// CORS Middleware
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',')
      .map((u) => u.trim())
      .filter(Boolean)
  : [];

// A wildcard is tolerated while developing but refused in production, where an
// open CORS policy would let any site issue authenticated admin requests.
const wildcardAllowed = allowedOrigins.includes('*') && !isProduction();

if (allowedOrigins.includes('*') && isProduction()) {
  console.warn(
    '⚠️  CLIENT_URL is "*" in production. Requests from any origin will be accepted until you pin the real site URL.'
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, native apps, same-origin)
      if (!origin) {
        return callback(null, true);
      }
      if (wildcardAllowed || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

// Request Logging
if (!isProduction() || process.env.LOG_REQUESTS === 'true') {
  app.use(morgan(isProduction() ? 'combined' : 'dev'));
}

// Body Parser Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve Uploaded Files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the storefront and the admin panel from an explicit allowlist of files
// inside frontend/, instead of the repository root, which would also expose
// backend/, render.yaml and the scraper sources.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const PUBLIC_FILES = [
  'index.html',
  'products.html',
  'account.html',
  'style.css',
  'account.css',
  'script.js',
  'products.js',
  'account.js',
  'favicon.ico',
];

const PUBLIC_DIRS = ['assets'];

const serveRoot = express.static(FRONTEND_DIR);

const servePublic = (req, res, next) => {
  const requested = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');

  // Reject anything that tries to traverse out of the allowlist
  if (requested.includes('..') || requested.includes('\0')) {
    return next();
  }

  const isAllowedFile =
    PUBLIC_FILES.includes(requested) ||
    PUBLIC_DIRS.some(
      (dir) =>
        requested.startsWith(`${dir}/`) &&
        !requested.slice(dir.length + 2).includes('/')
    );

  if (!isAllowedFile) {
    return next();
  }

  return serveRoot(req, res, next);
};

app.use(servePublic);

// Admin dashboard (a self-contained single-page app in frontend/admin/index.html)
app.use(
  '/admin',
  express.static(path.join(FRONTEND_DIR, 'admin'), {
    index: 'index.html',
    extensions: [],
  })
);

// API Root info
app.get('/api', (req, res) => {
  res.json({
    status: 'online',
    name: 'مركز أبو ربيع للمعدات API',
    manager: 'م/ محمد أبو ربيع',
    version: '1.1.0',
    documentation: '/api/health',
  });
});

app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : mongoose.connection.readyState === 2
        ? 'connecting'
        : 'disconnected',
    offlineModeEnabled: env.ALLOW_OFFLINE_MODE,
    uptime: process.uptime(),
  });
});

// Mount API Routes
app.use('/api', apiLimiter);
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/categories', require('./routes/category.routes'));
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/orders', require('./routes/order.routes'));
app.use('/api/contacts', require('./routes/contact.routes'));
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/stats', require('./routes/stats.routes'));
app.use('/api/customers', require('./routes/customer.routes'));

// Error Handlers
const { notFound, errorHandler } = require('./middleware/error.middleware');
app.use(notFound);
app.use(errorHandler);

module.exports = app;
module.exports.env = env;