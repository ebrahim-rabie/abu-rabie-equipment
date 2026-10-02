const express = require('express');
const { getPublicSettings, updatePriceVisibility } = require('../controllers/settings.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();
router.get('/public', getPublicSettings);
router.put('/prices', protect, updatePriceVisibility);

module.exports = router;
