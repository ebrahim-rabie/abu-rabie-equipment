const express = require('express');
const router = express.Router();
const {
  login,
  getMe,
  updatePassword,
} = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimit.middleware');

router.post('/login', loginLimiter, login);
router.get('/me', protect, getMe);
router.put('/update-password', protect, passwordResetLimiter, updatePassword);

module.exports = router;
