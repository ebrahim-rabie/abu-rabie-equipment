const SiteSettings = require('../models/SiteSettings');

const getPublicSettings = async (req, res, next) => {
  try {
    const settings = await SiteSettings.findById('storefront').lean();
    return res.json({
      success: true,
      data: { showPrices: settings?.showPrices !== false },
    });
  } catch (error) {
    return next(error);
  }
};

const updatePriceVisibility = async (req, res, next) => {
  if (typeof req.body?.showPrices !== 'boolean') {
    return res.status(400).json({ success: false, message: 'showPrices must be true or false' });
  }

  try {
    const settings = await SiteSettings.findByIdAndUpdate(
      'storefront',
      { $set: { showPrices: req.body.showPrices } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();
    return res.json({ success: true, data: { showPrices: settings.showPrices } });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getPublicSettings, updatePriceVisibility };
