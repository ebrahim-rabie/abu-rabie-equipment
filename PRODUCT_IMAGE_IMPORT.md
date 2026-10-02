# Local product image import

From `backend/`, run:

```powershell
npm.cmd run import:images
```

The command matches `data/elkhalily_images.zip` files to catalog products by ID,
extracts supported images into `backend/uploads/product-images/`, and stores the
relative `/uploads/product-images/...` paths in MongoDB. It first saves the
previous `image` and `images` fields to an ignored JSON backup in `backend/data/`.
Products with custom image URLs are preserved. Running the command again is safe.

The archive and extracted images are excluded from Git. To move the catalog to a
different machine, copy the image archive there, configure the target MongoDB,
and run the same command. On a deployed host, ensure its `UPLOAD_DIR` points to
persistent writable storage before importing.
