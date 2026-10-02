const mongoose = require('mongoose');
const { offlineModeEnabled } = require('../config/env');

/**
 * True when MongoDB is reachable and queries can be trusted.
 */
const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * True when a controller may serve data from the local JSON fallback instead of
 * MongoDB. This is a development-only convenience: in production a missing
 * database terminates the process (see config/db.js), so the answer is always
 * false.
 */
const canUseOffline = () => !isDbConnected() && offlineModeEnabled();

/**
 * Guards the offline branch inside a controller. Returns true when the offline
 * store may be used; otherwise it sends 503 and returns false.
 *
 *   if (!isDbConnected()) {
 *     if (dbUnavailable(res)) return;   // responds and stops
 *     // ...offline branch
 *   }
 */
const dbUnavailable = (res) => {
  if (canUseOffline()) return false;
  res.status(503).json({
    success: false,
    message: 'قاعدة البيانات غير متاحة حالياً، يرجى المحاولة بعد قليل',
  });
  return true;
};

module.exports = { isDbConnected, canUseOffline, dbUnavailable };