const multer = require('multer');
const path = require('path');

// Keep uploads in memory only until the controller streams them into MongoDB.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const extension = path.extname(file.originalname).toLowerCase();

  if (allowedTypes[extension] === file.mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, WEBP, AVIF, and GIF images are allowed'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});

module.exports = upload;
