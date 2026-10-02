const express = require('express');
const router = express.Router();
const {
  getAllProducts,
  getProductBySlug,
  getFeaturedProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/product.controller');
const { protect } = require('../middleware/auth.middleware');

router.get('/', getAllProducts);
router.get('/featured', getFeaturedProducts);
router.get('/:slug', getProductBySlug);
router.post('/', protect, createProduct);
router.put('/:id', protect, updateProduct);
router.delete('/:id', protect, deleteProduct);

module.exports = router;
