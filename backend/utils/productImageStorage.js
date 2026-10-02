const mongoose = require('mongoose');

const BUCKET_NAME = 'productImages';

const getProductImageBucket = () => {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB must be connected before accessing product images');
  }

  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME,
  });
};

const contentTypeForFilename = (filename) => {
  const extension = String(filename).toLowerCase().split('.').pop();
  return {
    avif: 'image/avif',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }[extension] || 'application/octet-stream';
};

module.exports = { BUCKET_NAME, contentTypeForFilename, getProductImageBucket };
