const express = require('express');
const router = express.Router();

const {
  register,
  login,
  getMe,
  updateProfile,
  updatePassword,
  deleteAccount,
  getAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getMyOrders,
} = require('../controllers/customer.controller');

const {
  getCart,
  addToCart,
  updateQuantity,
  removeItem,
  clearCart,
  mergeCart,
} = require('../controllers/cart.controller');

const { protectCustomer } = require('../middleware/customerAuth.middleware');
const {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimit.middleware');

// --- Authentication ---------------------------------------------------------
router.post('/auth/register', registerLimiter, register);
router.post('/auth/login', loginLimiter, login);

// --- Profile ----------------------------------------------------------------
router.get('/auth/me', protectCustomer, getMe);
router.put('/profile', protectCustomer, updateProfile);
router.put('/password', protectCustomer, passwordResetLimiter, updatePassword);
router.delete('/account', protectCustomer, deleteAccount);

// --- Addresses --------------------------------------------------------------
router.get('/addresses', protectCustomer, getAddresses);
router.post('/addresses', protectCustomer, addAddress);
router.put('/addresses/:id', protectCustomer, updateAddress);
router.delete('/addresses/:id', protectCustomer, deleteAddress);

// --- Cart -------------------------------------------------------------------
// merge must be declared before the :productId routes so it is not swallowed
router.post('/cart/merge', protectCustomer, mergeCart);
router.get('/cart', protectCustomer, getCart);
router.post('/cart', protectCustomer, addToCart);
router.put('/cart/:productId', protectCustomer, updateQuantity);
router.delete('/cart/:productId', protectCustomer, removeItem);
router.delete('/cart', protectCustomer, clearCart);

// --- Order history ----------------------------------------------------------
router.get('/orders', protectCustomer, getMyOrders);

module.exports = router;