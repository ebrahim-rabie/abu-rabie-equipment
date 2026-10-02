const express = require('express');
const router = express.Router();
const {
  submitContact,
  getAllContacts,
  markAsRead,
  deleteContact,
} = require('../controllers/contact.controller');
const { protect } = require('../middleware/auth.middleware');
const { contactLimiter } = require('../middleware/rateLimit.middleware');

router.post('/', contactLimiter, submitContact);
router.get('/', protect, getAllContacts);
router.put('/:id/read', protect, markAsRead);
router.delete('/:id', protect, deleteContact);

module.exports = router;
