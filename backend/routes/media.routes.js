const express = require('express');
const { serveProductImage } = require('../controllers/media.controller');

const router = express.Router();
router.get('/:filename', serveProductImage);

module.exports = router;
