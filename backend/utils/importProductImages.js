const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendDir = path.join(__dirname, '..');
const repoDir = path.join(backendDir, '..');
dotenv.config({ path: path.join(backendDir, '.env') });

const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : process.env.RENDER
    ? '/var/data/uploads'
    : path.join(backendDir, 'uploads');
const imageDir = path.join(uploadsDir, 'product-images');
const archive = path.join(repoDir, 'data', 'elkhalily_images.zip');
const dataset = path.join(repoDir, 'data', 'elkhalily_products.json');
const extractor = path.join(repoDir, 'data', 'import_product_images.py');

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from backend/.env');
  for (const file of [archive, dataset, extractor]) {
    if (!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
  }

  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  console.log(`Extracting product images to ${imageDir}...`);
  const result = spawnSync(python, [extractor, archive, dataset, imageDir], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Image extraction exited ${result.status}`);
  if (result.stderr) process.stderr.write(result.stderr);

  const manifest = JSON.parse(result.stdout);
  const Product = require('../models/Product');
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  try {
    const products = await Product.find({ sourceId: { $in: Object.keys(manifest.images) } })
      .select('_id sourceId image images')
      .lean();
    const operations = [];
    const skippedCustom = [];
    const migrationBackup = [];

    for (const product of products) {
      const localImages = manifest.images[String(product.sourceId)];
      const firstImageFile = localImages?.[0]?.replace(/^\/uploads\/product-images\//, '');
      if (!firstImageFile || !fs.existsSync(path.join(imageDir, firstImageFile))) {
        continue;
      }

      const currentImage = String(product.image || '');
      const isSupplierImage = /^https?:\/\/(?:www\.)?elkhalily\.com\//i.test(currentImage);
      const isFallback = !currentImage || currentImage === 'assets/logo.jpg';
      const isAlreadyLocal = currentImage.startsWith('/uploads/product-images/');
      if (!isSupplierImage && !isFallback && !isAlreadyLocal) {
        skippedCustom.push(String(product.sourceId));
        continue;
      }
      if (isAlreadyLocal) continue;

      migrationBackup.push({
        _id: product._id,
        sourceId: product.sourceId,
        image: product.image,
        images: product.images,
      });
      operations.push({
        updateOne: {
          filter: { _id: product._id, image: product.image },
          update: { $set: { image: localImages[0], images: localImages } },
        },
      });
    }

    let modifiedCount = 0;
    if (operations.length) {
      const backupPath = path.join(backendDir, 'data', `image-migration-backup-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, JSON.stringify(migrationBackup, null, 2), 'utf8');
      const result = await Product.bulkWrite(operations, { ordered: false });
      modifiedCount = result.modifiedCount;
      console.log(`Saved the pre-migration image fields to ${backupPath}`);
    }

    console.log(`Products found in MongoDB: ${products.length}`);
    console.log(`Products updated to local image paths: ${modifiedCount}`);
    console.log(`Custom product images preserved: ${skippedCustom.length}`);
    console.log(`Products in archive without an image: ${manifest.missingIds.length}`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('Product image import failed:', error.message);
  process.exitCode = 1;
});
