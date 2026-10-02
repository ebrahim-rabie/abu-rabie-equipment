# Store product images in MongoDB Atlas

Product image binaries are stored in the `productImages.files` and
`productImages.chunks` GridFS collections in the same Atlas database as product
records. Product `image` and `images` fields contain public `/media/<filename>`
URLs; the Express backend streams each image from Atlas.

## Import the catalogue archive

Place `elkhalily_images.zip` at `data/elkhalily_images.zip`, configure
`backend/.env` with the target database's `MONGODB_URI`, then run from
`backend/`:

```powershell
npm.cmd run import:images
```

The importer extracts supported files to `backend/uploads/product-images/` as a
temporary source, uploads them to GridFS, and changes matching product image
paths in MongoDB to `/media/...`. Re-running is safe: existing files with the
same name and byte size are skipped. Before changing product paths, it writes a
backup JSON file under the ignored `backend/data/` directory.

The `backend/uploads/product-images/` directory is only an import cache; the
storefront reads images from Atlas. The source ZIP and extracted files are
excluded from Git. Never run the importer with a production URI unless that is
the intended target database.

## Atlas storage capacity

The full image set is about 206 MiB before GridFS metadata and indexes. Atlas
Free clusters have a hard 0.5 GB total data-and-index limit. Check available
cluster storage before importing, and upgrade or use external object storage if
the catalogue grows beyond the available capacity.
