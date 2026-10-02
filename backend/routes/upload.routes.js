const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const {
  uploadSingle,
  uploadMultiple,
} = require('../controllers/upload.controller');
const { protect } = require('../middleware/auth.middleware');
const { uploadLimiter } = require('../middleware/rateLimit.middleware');

router.post('/image', protect, uploadLimiter, upload.single('image'), uploadSingle);
router.post('/images', protect, uploadLimiter, upload.array('images', 5), uploadMultiple);

module.exports = router;
