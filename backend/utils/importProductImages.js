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

const uploadToGridFS = (bucket, filePath, filename) =>
  new Promise((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, {
      metadata: {
        contentType: require('./productImageStorage').contentTypeForFilename(filename),
        source: 'catalog-import',
      },
    });
    fs.createReadStream(filePath).pipe(upload).on('finish', resolve).on('error', reject);
  });

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

  const mongoose = require('mongoose');
  const Product = require('../models/Product');
  const { getProductImageBucket } = require('./productImageStorage');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  try {
    const bucket = getProductImageBucket();
    const filenames = [...new Set(Object.values(manifest.images).flat().map((imagePath) => {
      const filename = path.posix.basename(imagePath);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(filename)) {
        throw new Error(`Unsafe image filename in manifest: ${filename}`);
      }
      return filename;
    }))];

    let imported = 0;
    let alreadyStored = 0;
    for (const filename of filenames) {
      const filePath = path.join(imageDir, filename);
      if (!fs.existsSync(filePath)) continue;
      const size = fs.statSync(filePath).size;
      const [existing] = await bucket.find({ filename }).sort({ uploadDate: -1 }).limit(1).toArray();
      if (existing?.length === size) {
        alreadyStored += 1;
        continue;
      }
      if (existing) await bucket.delete(existing._id);
      await uploadToGridFS(bucket, filePath, filename);
      imported += 1;
      if (imported % 100 === 0) console.log(`Stored ${imported} images in Atlas...`);
    }

    const sourceIds = Object.keys(manifest.images);
    const products = await Product.find({ sourceId: { $in: sourceIds } })
      .select('_id sourceId image images')
      .lean();
    const operations = [];
    const backup = [];

    for (const product of products) {
      const rewritePath = (value) => {
        const imagePath = String(value || '');
        if (!imagePath.startsWith('/uploads/product-images/')) return imagePath;
        const filename = path.posix.basename(imagePath);
        return filenames.includes(filename) ? `/media/${filename}` : imagePath;
      };
      const nextImage = rewritePath(product.image);
      const nextImages = (Array.isArray(product.images) ? product.images : []).map(rewritePath);
      if (nextImage === product.image && nextImages.every((value, index) => value === product.images?.[index])) {
        continue;
      }
      backup.push({ _id: product._id, sourceId: product.sourceId, image: product.image, images: product.images });
      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { image: nextImage, images: nextImages } },
        },
      });
    }

    let updatedProducts = 0;
    if (operations.length) {
      const backupPath = path.join(backendDir, 'data', `image-migration-backup-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
      const updateResult = await Product.bulkWrite(operations, { ordered: false });
      updatedProducts = updateResult.modifiedCount;
      console.log(`Saved previous product image paths to ${backupPath}`);
    }

    console.log(`Products found in MongoDB: ${products.length}`);
    console.log(`Image files stored in Atlas this run: ${imported}`);
    console.log(`Image files already present in Atlas: ${alreadyStored}`);
    console.log(`Products updated to Atlas image URLs: ${updatedProducts}`);
    console.log(`Products in archive without an image: ${manifest.missingIds.length}`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('Product image import failed:', error.message);
  process.exitCode = 1;
});
