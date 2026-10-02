# Production launch status

The original proposal is obsolete: its work has been implemented in the current
repository layout (`frontend/`, `backend/`, and `data/`). Use `render.yaml` as the
deployment source of truth. The blueprint currently uses Render's free plan as
a preview configuration; select a paid web-service plan in Render before
accepting customer orders. Free services can sleep and are not intended for
production availability.

## Before deployment

- Commit the intended files, including the frontend move and root-level data
  required by the product seeder. Do not commit `backend/.env`, local database
  files, uploaded images, or the 203 MB image archive.
- In Render, provide a working MongoDB Atlas `MONGODB_URI`, the deployed origin
  as `CLIENT_URL`, a unique admin email, and a strong unique `ADMIN_PASSWORD`.
- Rotate the Atlas database password that was shared in chat, then create a
  dedicated database user limited to the `abu_rabie` database. Do not use an
  Atlas Admin account as the website's database user.
- Add Render's service outbound IP ranges to the Atlas project's Network Access
  list. Do not use `0.0.0.0/0` for production.
- Keep the generated `JWT_SECRET`; do not replace it with a shared or example
  secret.
- Atlas already contains an admin account. Setting Render's `ADMIN_PASSWORD`
  will not change that existing account. After the first HTTPS login, change
  the admin password through `PUT /api/auth/update-password` using the current
  password and a new unique password of at least 16 characters.
- Product image binaries are stored in MongoDB Atlas GridFS and served from the
  backend `/media/:filename` route. The current catalogue image import is about
  206 MiB; confirm Atlas storage headroom before importing or growing the
  catalogue. No Render disk is needed for these Atlas-backed images; admin image
  uploads are written directly to Atlas GridFS.
- Confirm rights to publish the supplier product data and images.
- Atlas free clusters do not provide managed backups. Enable Atlas backups on a
  paid cluster or make and restore-test a `mongodump` backup before accepting
  orders.

## After deployment

Follow [DEPLOYMENT_SMOKE_CHECK.md](DEPLOYMENT_SMOKE_CHECK.md). Verify the health
endpoint reports a connected database, the product catalogue is populated, admin
login works, and a test image stored in Atlas remains available after a service
restart.

Do not treat the service as production-ready until the smoke checks pass and
database backups are configured.
