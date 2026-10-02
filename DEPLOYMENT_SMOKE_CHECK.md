# Deployment smoke check

Replace `APP_URL` with the deployed HTTPS origin, without a trailing slash.
Use a temporary product and image for write checks, then remove them afterward.

Before the first deploy, rotate the Atlas password shared in chat, create a
database user limited to `abu_rabie`, and add the Render service's outbound IP
ranges to Atlas Network Access. Deploy a preview first; choose a paid Render
service and a tested Atlas backup plan before treating it as production.

## Public site and API

- [ ] `GET APP_URL/` returns the storefront.
- [ ] `GET APP_URL/products.html` returns the catalogue page.
- [ ] `GET APP_URL/admin/` returns the admin login page and its script loads.
- [ ] `GET APP_URL/api/health` returns `success: true` and `database: "connected"`.
- [ ] `GET APP_URL/api/products?page=1&limit=24` returns products and pagination
      metadata (`total`, `totalPages`, `page`, and `limit`).
- [ ] `GET APP_URL/api/categories` returns the product categories.
- [ ] Requests for `APP_URL/backend/.env`, `APP_URL/render.yaml`, and
      `APP_URL/data/elkhalily_products.json` return 404.

## Admin workflow

- [ ] Log in at `/admin/` using the credentials configured in Render.
- [ ] Create a temporary product, edit it, and delete it.
- [ ] Upload a small JPG or PNG and confirm it loads from the returned `/media/`
      URL. Product image binaries should appear in Atlas `productImages.files`
      and `productImages.chunks`.
- [ ] Restart or redeploy the service, then confirm the uploaded image URL still
      loads from Atlas.
- [ ] Confirm an invalid login is rejected and admin APIs require authentication.

## Storefront workflow

- [ ] In the admin products tab, hide prices; reload the home, catalogue,
      product detail, cart, and account pages and confirm customer price labels
      are hidden. Show prices again and confirm the setting persists after reload.
- [ ] Search for a product and move between catalogue pages.
- [ ] Add a product to the cart and confirm the displayed price matches the API.
- [ ] Submit a small test order and verify it appears in the admin order list.
- [ ] Submit a test contact message and verify it appears in the admin inbox.

## Before accepting real orders

- [ ] Verify Render has `NODE_ENV=production`, a generated strong `JWT_SECRET`,
      a real Atlas URI, the exact deployed origin in `CLIENT_URL`, a unique admin
      email, and a strong admin password.
- [ ] Confirm `ALLOW_OFFLINE_MODE=false` and the health endpoint reports the
      database connected.
- [ ] Configure and verify MongoDB backups.
- [ ] Remove test products, orders, and contact messages.
