# Production launch status

The original proposal is obsolete: its work has been implemented in the current
repository layout (`frontend/`, `backend/`, and `data/`). Use `render.yaml` as the
deployment source of truth.

## Before deployment

- Commit the intended files, including the frontend move and root-level data
  required by the product seeder. Do not commit `backend/.env`, local database
  files, uploaded images, or the 203 MB image archive.
- In Render, provide a working MongoDB Atlas `MONGODB_URI`, the deployed origin
  as `CLIENT_URL`, a unique admin email, and a strong unique `ADMIN_PASSWORD`.
- Keep the generated `JWT_SECRET`; do not replace it with a shared or example
  secret.
- The Render Blueprint mounts a 1 GB persistent disk at `/var/data` and stores
  admin uploads in `/var/data/uploads`. Confirm the selected Render plan supports
  the disk before deploying; if it does not, use an external object store or a
  plan with persistent disks before accepting product image uploads.
- Confirm rights to publish the supplier product data and images.

## After deployment

Follow [DEPLOYMENT_SMOKE_CHECK.md](DEPLOYMENT_SMOKE_CHECK.md). Verify the health
endpoint reports a connected database, the product catalogue is populated, admin
login works, and a test image remains available after a service restart.

Do not treat the service as production-ready until the smoke checks pass and
database backups are configured.
