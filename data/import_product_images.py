"""Extract the local Elkhalily image archive using product IDs for filenames.

Usage: python import_product_images.py ARCHIVE PRODUCTS_JSON OUTPUT_DIR
The script writes a JSON mapping to stdout and sends progress to stderr.
"""

import json
import os
import re
import shutil
import sys
import zipfile


def main():
    archive_path, products_path, output_dir = sys.argv[1:4]
    with open(products_path, encoding="utf-8") as source:
        products = json.load(source)

    product_ids = {str(item.get("id", "")).strip() for item in products}
    product_ids.discard("")
    images_by_id = {product_id: [] for product_id in product_ids}
    image_pattern = re.compile(r"^(\d+)_.*\.(jpe?g|png|webp|avif|gif)$", re.IGNORECASE)

    os.makedirs(output_dir, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            filename = os.path.basename(entry.filename)
            match = image_pattern.match(filename)
            if match and match.group(1) in images_by_id:
                images_by_id[match.group(1)].append((filename, entry))

        manifest = {}
        extracted = 0
        for product_id, entries in images_by_id.items():
            if not entries:
                continue
            def image_order(pair):
                filename = pair[0]
                suffix = re.search(r"_(\d+)\.[^.]+$", filename)
                return (int(suffix.group(1)) if suffix else 0, filename.lower())

            entries.sort(key=image_order)
            paths = []
            for number, (original_name, entry) in enumerate(entries, start=1):
                extension = os.path.splitext(original_name)[1].lower()
                output_name = f"{product_id}-{number}{extension}"
                output_path = os.path.join(output_dir, output_name)
                if not os.path.exists(output_path) or os.path.getsize(output_path) != entry.file_size:
                    with archive.open(entry) as compressed, open(output_path, "wb") as output:
                        shutil.copyfileobj(compressed, output)
                paths.append(f"/uploads/product-images/{output_name}")
                extracted += 1
            manifest[product_id] = paths

    missing_ids = sorted(product_ids - manifest.keys())
    print(
        f"Matched {len(manifest)}/{len(product_ids)} products; "
        f"prepared {extracted} image files; {len(missing_ids)} products have no local image.",
        file=sys.stderr,
    )
    print(json.dumps({"images": manifest, "missingIds": missing_ids}))


if __name__ == "__main__":
    main()
