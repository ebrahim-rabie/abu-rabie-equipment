const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'storefront' },
    showPrices: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
