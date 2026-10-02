const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const { contentTypeForFilename, getProductImageBucket } = require('../utils/productImageStorage');

const saveImage = async (file) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const filename = `product-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  const bucket = getProductImageBucket();
  const upload = bucket.openUploadStream(filename, {
    metadata: { contentType: file.mimetype || contentTypeForFilename(filename) },
  });

  await new Promise((resolve, reject) => {
    Readable.from([file.buffer]).pipe(upload).on('finish', resolve).on('error', reject);
  });
  return filename;
};

const responseFor = (req, filename) => ({
  filename,
  url: `${req.protocol}://${req.get('host')}/media/${filename}`,
  path: `/media/${filename}`,
});

// @route POST /api/upload/image (admin only)
const uploadSingle = async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file was provided' });
  }

  try {
    const filename = await saveImage(req.file);
    return res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: responseFor(req, filename),
    });
  } catch (error) {
    return next(error);
  }
};

// @route POST /api/upload/images (admin only, max five images)
const uploadMultiple = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No image files were provided' });
  }

  try {
    const uploaded = [];
    for (const file of req.files) {
      uploaded.push(responseFor(req, await saveImage(file)));
    }
    return res.json({
      success: true,
      message: `${uploaded.length} images uploaded successfully`,
      data: uploaded,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { uploadSingle, uploadMultiple };
