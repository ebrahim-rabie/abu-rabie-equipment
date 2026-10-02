const express = require('express');
const router = express.Router();
const {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
} = require('../controllers/order.controller');
const { protect } = require('../middleware/auth.middleware');
const { optionalCustomer } = require('../middleware/customerAuth.middleware');
const { orderLimiter } = require('../middleware/rateLimit.middleware');

// Guest checkout is allowed; a customer token simply links the order to the
// account so it shows up in their history.
router.post('/', orderLimiter, optionalCustomer, createOrder);
router.get('/', protect, getAllOrders);
router.get('/:id', protect, getOrderById);
router.put('/:id/status', protect, updateOrderStatus);
router.delete('/:id', protect, deleteOrder);

module.exports = router;
