const { contentTypeForFilename, getProductImageBucket } = require('../utils/productImageStorage');

const serveProductImage = async (req, res, next) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(filename)) {
    return res.status(400).json({ success: false, message: 'Invalid image name' });
  }

  try {
    const bucket = getProductImageBucket();
    const [file] = await bucket.find({ filename }).sort({ uploadDate: -1 }).limit(1).toArray();
    if (!file) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    const etag = `"${file._id}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    res.set({
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': file.metadata?.contentType || contentTypeForFilename(filename),
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    bucket.openDownloadStream(file._id).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
};

module.exports = { serveProductImage };
