# Production Launch Plan — Abu Rabie Equipment Center (مركز أبو ربيع للمعدات)

> **Status:** Proposed — awaiting approval
> **Branch:** `feat/production-launch`
> **Target:** Single Render web service (free plan) + MongoDB Atlas (M0 free tier)
> **Owner:** Eng. Mohamed Abu Rabie

---

## 1. Confirmed Scope

| Area | Decision |
|---|---|
| Database | **MongoDB Atlas** (M0 free tier) |
| Product data | **Keep the scraped `elkhalily_products.json` dataset** (826 records) |
| Customer accounts | **Phone + password** login, included in this launch |
| Payment | **Cash on delivery + WhatsApp order confirmation** (no online gateway) |
| Product image uploads | **Local disk** (`backend/uploads`) — ephemeral, accepted tradeoff |
| Offline JSON fallback | **Gated behind an env flag**, disabled in production |

### Explicitly out of scope

- Online payments (Paymob / Fawry)
- SMS / OTP verification
- Self-hosting product images from `elkhalily_images.zip` (separate project)
- Customer-facing admin features beyond accounts, cart, and order history

---

## 2. Current State Assessment

### Architecture

```
Static site (RTL Arabic)          Express 4 API (CommonJS)         Mongoose models
├── index.html      (183 lines)   ├── server.js         (121)       ├── Admin      (57)
├── products.html   (109)         ├── routes/     (7 files)        ├── Product    (112)
├── products.js     (409)         ├── controllers/ (7 files)        ├── Order       (98)
├── script.js        (75)         ├── middleware/  (3 files)        ├── Category    (54)
├── style.css       (888)         ├── utils/       (4 files)        └── Contact     (39)
└── admin/index.html (1271)       └── config/db.js     (20)
```

- The backend serves the **entire site** (`server.js:61`) and the admin panel (`server.js:58`).
- Every controller has a dual code path: MongoDB **or** a JSON-file fallback (`utils/offlineStore.js`).
- Git: a single commit (`472e942 Initial commit`). Backend, admin, dataset, and deployment config are all **untracked**.

### Blocking issues, ranked

| Severity | Issue | Location |
|---|---|---|
| 🔴 Critical | Order total is computed from **client-supplied prices** | `order.controller.js:37-49` |
| 🔴 Critical | Any valid JWT grants **superadmin when Mongo is down** | `middleware/auth.middleware.js:28-37` |
| 🔴 Critical | Fallback login accepts `ADMIN_USERNAME`/`ADMIN_PASSWORD` from env | `controllers/auth.controller.js:28-29,63-77` |
| 🟠 High | CORS allows every origin unconditionally | `server.js:37` |
| 🟠 High | `express.static(repoRoot)` exposes the whole repo, incl. `backend/`, `render.yaml`, the scraper | `server.js:61` |
| 🟠 High | No rate limiting on login, orders, or contact form | — |
| 🟠 High | Catalog UI hard-caps at 100 products; dataset has 826 | `products.js:32`, `admin/index.html:1009` |
| 🟡 Medium | Unescaped user input passed to `new RegExp()` (ReDoS) | `product.controller.js:91`, `order.controller.js:123` |
| 🟡 Medium | `isFeatured` uses `Math.random()` — flips on every re-seed | `utils/seeder.js:215` |
| 🟡 Medium | Seeder is ~2,500 sequential DB round-trips | `utils/seeder.js:196-228` |
| 🟡 Medium | `specs` (JSON string) and `images[]` (multi-image) are silently dropped on seed | `utils/seeder.js:203-219` |
| 🟡 Medium | Product `slug` is random → changes on every save | `models/Product.js:95-107` |
| 🟢 Low | No tests exist | — |
| 🟢 Low | Unused `slugify` dependency | `backend/package.json` |
| 🟢 Low | README claims 48 products; actual is 826 | `backend/README.md` |

---

## 3. Phase 0 — Foundation

**Estimate:** Day 1, ~1 hour

### 0.1 — Create working branch
```bash
git switch -c feat/production-launch
```
The repository has one commit; everything else is untracked. Work on a branch, commit in coherent stages.

### 0.2 — Harden `.gitignore`

Current file ignores only 8 patterns. Add:

```gitignore
node_modules/
backend/node_modules/
backend/.env
backend/uploads/*
!backend/uploads/.gitkeep
backend/data/*.json
!backend/data/*.example.json
__pycache__/
*.pyc
*.log
.DS_Store
Thumbs.db

# Scraped dataset + exports (regenerate with data/run_scraper.bat)
data/elkhalily_images.zip
data/elkhalily_products*.csv
```

> ⚠️ `data/elkhalily_images.zip` is **203 MB** and currently untracked but not ignored — a `git add -A` would commit it. Delete it locally (see §8, Decision 4).

### 0.3 — Remove unused dependency
`slugify` is declared in `backend/package.json` but never imported anywhere.

```bash
cd backend && npm uninstall slugify
```

### 0.4 — Eliminate hardcoded secrets

Three fallback literals must go:

- `controllers/auth.controller.js:9` — `process.env.JWT_SECRET || 'abu_rabie_secret_key'`
- `middleware/auth.middleware.js:25` — same literal
- `backend/.env` — `JWT_SECRET=abu_rabie_secret_key_development_2026`, `ADMIN_PASSWORD=admin123`

**Replace with:** a shared `backend/config/env.js` that throws at boot if `JWT_SECRET` is missing or shorter than 32 characters when `NODE_ENV === 'production'`.

```js
// backend/config/env.js
const assertSecret = (name, minLength) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  if (process.env.NODE_ENV === 'production' && value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters in production`);
  }
  return value;
};
```

### 0.5 — Documentation
- Correct the product count in `backend/README.md`.
- Document every `.env` variable and the Atlas setup path (see §9).

**Exit criteria:** `npm ci && npm start` boots cleanly; `git status` shows no secrets or large binaries staged.

---

## 4. Phase 1 — Security Hardening

**Estimate:** Day 1–2, ~4 hours · **Priority: highest**

### 1.1 — Server-authoritative order pricing 🔴

`order.controller.js:37-49` trusts whatever price the browser sends:

```js
const price = Number(item.price) || 0;   // ← attacker-controlled
total += price * quantity;
```

**Fix:** look up every line item in Mongo and price it server-side.

```js
const ids = items.map((i) => i.productId || i.product).filter(Boolean);
const products = await Product.find({ _id: { $in: ids } }).select('name sku price salePrice inStock image');
const byId = new Map(products.map((p) => [String(p._id), p]));

const validatedItems = items.map((item) => {
  const product = byId.get(String(item.productId || item.product));
  if (!product) throw Object.assign(new Error(`منتج غير موجود: ${item.name}`), { status: 400 });
  if (!product.inStock) throw Object.assign(new Error(`${product.name} غير متوفر حالياً`), { status: 400 });
  const price = product.salePrice || product.price;
  return { product: product._id, name: product.name, sku: product.sku, price, quantity: qty, image: product.image };
});
```

Apply the same rule to `checkout` from any future client. `totalAmount` becomes a pure server computation.

### 1.2 — Remove the offline auth bypass 🔴

`middleware/auth.middleware.js:28-37` grants superadmin to **any** correctly-signed JWT when Mongo is unreachable. Combined with the weak default secret, a production instance without a valid `MONGODB_URI` is fully open.

**Fix:** delete the branch. `protect` should query `Admin.findById(decoded.id)`; a miss is a 401.

### 1.3 — Remove env-based login 🔴

`controllers/auth.controller.js:63-77` logs in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` even when Mongo is connected. Delete; the `Admin` collection becomes the single source of truth.

### 1.4 — Restrict CORS 🟠

`server.js:37` ends with `return callback(null, true)` — the origin check is decorative.

```js
origin: (origin, callback) => {
  if (!origin) return callback(null, true);            // curl, mobile, same-origin
  if (allowedOrigins.includes('*') && process.env.NODE_ENV !== 'production')
    return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS'));
}
```

Then pin `CLIENT_URL` to the real Render origin in production (§7).

### 1.5 — Escape user input used in regex 🟡

`product.controller.js:91,120` and `order.controller.js:123` build `new RegExp(search.trim(), 'i')` from raw input.

Add `backend/utils/escapeRegex.js`:
```js
module.exports = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
```
Apply at every `new RegExp(...)` construction that includes user input.

### 1.6 — Add rate limiting 🟠

New dependency `express-rate-limit`:

| Route | Limit |
|---|---|
| `POST /api/auth/login` | 5 per 15 min |
| `POST /api/customers/auth/register` | 3 per hour |
| `POST /api/orders` | 10 per hour |
| `POST /api/contacts` | 5 per hour |

Skip counting successful logins where practical.

### 1.7 — Stop serving the whole repository 🟠 ✅ RESOLVED

`server.js` used to do `express.static(path.join(__dirname, '..'))`, exposing `backend/`, `render.yaml`, `scrape_elkhalily.py`, and the dataset JSON. (`backend/.env` is protected only by `serve-static`'s dotfile rule — not a boundary worth relying on.)

**Fix as implemented:** public files now live in `frontend/`, and `backend/app.js` serves that one directory through an explicit `PUBLIC_FILES` / `PUBLIC_DIRS` allowlist. `backend/`, `data/`, `.env` and `render.yaml` are unreachable over HTTP. Verified by `tests/security.test.js` and by a boot smoke test asserting 404 for every non-frontend path.

### 1.8 — Enable CSP

`helmet({ contentSecurityPolicy: ... })` with `img-src 'self' https://elkhalily.com data:`, plus `referrerpolicy="no-referrer"` on hotlinked `<img>` tags.

### 1.9 — Rotate default credentials

Generate a random `ADMIN_PASSWORD`; keep `admin123` only in `.env.example` as an explicit local-dev placeholder.

**Exit criteria:** No admin endpoint responds without a Mongo-issued JWT; `POST /api/orders` with `price: 1` is ignored; a foreign `Origin` header is rejected.

---

## 5. Phase 2 — MongoDB Atlas & Data Seeding

**Estimate:** Day 2, ~3 hours

### 2.1 — Provision Atlas

1. Create a free **M0** cluster (Atlas free tier, 512 MB).
2. Database Access → add a user with **Read and Write to any database**.
3. Network Access → allow Render's egress. Simplest is `0.0.0.0/0`; note the tradeoff in the README.
4. Copy the SRV string into `MONGODB_URI`.

### 2.2 — Add indexes

New file `backend/config/indexes.js`, invoked after a successful connect in `config/db.js`.

```js
Product.index({ slug: 1 }, { unique: true });
Product.index({ sku: 1 }, { unique: true, sparse: true });
Product.index({ name: 'text', description: 'text', sku: 'text', brand: 'text', categoryName: 'text' },
              { weights: { name: 10, sku: 8, brand: 5, categoryName: 3, description: 1 } });
Product.index({ category: 1, inStock: 1, sortOrder: 1 });

Order.index({ orderNumber: 1 }, { unique: true });
Order.index({ customerPhone: 1 });
Order.index({ user: 1, createdAt: -1 });
Order.index({ createdAt: -1 });
Order.index({ status: 1, createdAt: -1 });

Contact.index({ createdAt: -1 });
Contact.index({ isRead: 1 });
```

The text index matters: it turns catalog search from a full-collection regex scan into an indexed lookup once the dataset grows.

### 2.3 — Rewrite the seeder

`utils/seeder.js` has seven distinct problems:

| # | Problem | Line | Fix |
|---|---|---|---|
| a | `isFeatured: discount > 15 \|\| Math.random() < 0.2` — non-deterministic, flips on every run | `:215` | Deterministic rule: top 40 by `discountPct` + first 8 per category |
| b | ~2,500 sequential round-trips (`findOne` + `findByIdAndUpdate`/`create` per product) | `:196-228` | Single `bulkWrite` with `upsert: true` |
| c | `specs` is a **JSON string** in the dataset and is never passed through | `:203-219` | `JSON.parse(item.specs)` before storing into the `Mixed` field |
| d | `images` ignored — only `[item.image]` persisted | `:213` | `item.images.split(' \| ')` → full gallery array |
| e | No idempotency — match is by `$or: [sku, name]`, so renamed products duplicate | `:196-201` | Add `sourceId` (the scraped `id`) with a unique sparse index; upsert on it |
| f | Random slug from the `pre('save')` hook | `models/Product.js:95-107` | Deterministic slug from `sku` (slugified) or `sourceId` |
| g | ~100 raw category strings create ~100 categories | `:172-185` | Map the top 4 into the seeded categories, everything else → `أخرى` |

Also add:
- `SEED_RESET=1` to drop collections before seeding
- Summary report: inserted / updated / skipped, category breakdown, products missing images or prices
- Connection with the same options as `config/db.js` (currently the seeder calls `mongoose.connect` directly)

### 2.4 — Gate offline mode

`config/db.js:14` currently only exits in production when the DB fails. Make the offline dataset fallback opt-in:

```
ALLOW_OFFLINE_MODE = false by default; true only in local dev
```

In production, a failed Mongo connection must terminate the process. Change the condition from `NODE_ENV === 'production'` to "not explicitly opted in".

**Exit criteria:** `npm run seed` inserts 826 products; a second run reports `0 inserted / 826 updated`; `curl /api/health` shows `database: connected`.

---

## 6. Phase 3 — Catalog Scalability

**Estimate:** Day 3, ~4 hours

The dataset is 826 products; the UI shows 100 and slices the category list to 6.

### 3.1 — Server-driven pagination
`products.js:32` requests `?limit=100` and never uses the `totalPages` the API already returns (`product.controller.js:126`). Switch to 24 per page with page controls bound to `currentPage` / `totalPages`.

### 3.2 — Full category list
`products.js:86` does `Array.from(categoriesSet).slice(0, 6)`. Fetch `/api/categories` (already implemented, includes `productCount`) and render the complete list in a scrollable container with counts.

### 3.3 — Search on the server
`products.js:111-114` filters the in-memory array on every keystroke. Debounce 250ms and send `?search=`, so search works across all 826 products.

### 3.4 — Add filters
The API already supports `brand`, `inStock`, `minPrice`, `maxPrice`, `sort`, and returns a `brands` array (`product.controller.js:120`). Expose them in the UI — this code exists but no frontend consumes it.

### 3.5 — Fix `addToCart` (mandatory) ⚠️
`products.js:179` resolves the product via `allProducts.find(...)`. Once pagination replaces the full fetch, `allProducts` holds only the current page, so **the cart button breaks on pages 2+**.

Options: pass the product object into the click handler, or maintain an id→product `Map` that accumulates as pages are visited. Do not skip this step.

### 3.6 — Landing page featured section
Add a featured-products strip to `index.html` backed by `/api/products/featured`. Add `loading="lazy"`, `referrerpolicy="no-referrer"`, and keep the existing `onerror` fallback to `assets/logo.jpg`.

### 3.7 — Admin products table
`admin/index.html:1009` also caps at 100. Add server-side pagination + live search so all 826 are reachable from the panel.

### 3.8 — Product enquiry CTA
Floating "اسأل عن هذا المنتج" button that opens WhatsApp with the product name and SKU prefilled.

**Exit criteria:** All 826 products browsable and searchable; the cart works from any page.

---

## 7. Phase 4 — Customer Accounts

**Estimate:** Day 4–6, ~10 hours · **Largest phase**

### 7.1 — New backend files

```
backend/models/User.js
backend/models/Cart.js
backend/middleware/customerAuth.middleware.js
backend/controllers/customer.controller.js
backend/controllers/cart.controller.js
backend/routes/customer.routes.js
```

### 7.2 — `User` model

```js
phone:         { type: String, required: true, unique: true }   // normalized to 01xxxxxxxx
name:          { type: String, required: true, trim: true }
password:      { type: String, required: true, minlength: 8, select: false }
role:          { type: String, enum: ['customer'], default: 'customer' }
addresses: [{
  label: String, phone: String, governorate: String,
  city: String, street: String, isDefault: Boolean
}]
phoneVerified: { type: Boolean, default: false }
lastLogin:     Date
```

bcrypt pre-save hook mirroring `models/Admin.js:45`. `comparePassword` mirroring `models/Admin.js:53`.

### 7.3 — Phone normalization

```js
const normalizePhone = (raw = '') => {
  let d = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('20')) d = d.slice(2);
  if (d.startsWith('2') && d.length === 11) d = '0' + d.slice(1);
  return d;
};
// validate /^(01[0125])\d{8}$/
```
Reject duplicates with 409 rather than leaking whether an account exists on registration.

### 7.4 — `Cart` model

```js
{ user: { type: ObjectId, ref: 'User', unique: true },
  items: [{ product: { type: ObjectId, ref: 'Product' }, quantity: { type: Number, min: 1, default: 1 } }],
  timestamps: true }
```

Store only `product` + `quantity`. Prices are always resolved server-side at render and checkout time — never persisted client-supplied values.

### 7.5 — `customerAuth` middleware

Separate from admin `protect`. Verifies the token and requires `type: 'customer'`, then loads the user from the DB so role and existence are always authoritative.

### 7.6 — New endpoints

| Method | Path | Access |
|---|---|---|
| POST | `/api/customers/auth/register` | Public (rate limited) |
| POST | `/api/customers/auth/login` | Public (rate limited) |
| GET | `/api/customers/auth/me` | Customer |
| PUT | `/api/customers/profile` | Customer |
| PUT | `/api/customers/password` | Customer |
| GET/POST/PUT/DELETE | `/api/customers/addresses[/:id]` | Customer |
| GET | `/api/customers/orders` | Customer |
| GET | `/api/customers/cart` | Customer |
| POST | `/api/customers/cart/merge` | Customer |
| PUT | `/api/customers/cart/items/:productId` | Customer |
| DELETE | `/api/customers/cart/items/:productId` | Customer |
| DELETE | `/api/customers/cart` | Customer |

### 7.7 — Link orders to customers

Add an optional ref to `models/Order.js`:

```js
user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }
```

`order.controller.js` resolves `req.user?._id` from an optional customer token. Guest checkout is unchanged. `getAllOrders` in the admin panel gains a customer column and an optional `?user=` filter.

### 7.8 — Frontend

```
account.html     login | register | profile | addresses | orders  (tabs in one page)
js/account.js    state + JWT in localStorage key `abu_rabie_customer_token`
```

- "حسابي" link in the navbar; show the customer's name when authenticated.
- **Cart merge on login:** `POST /api/customers/cart/merge` with the local cart; server unions by `productId` and sums quantities.
- Logged out → local cart remains the source of truth (existing behavior preserved).
- Orders tab: status, date, total, item list, WhatsApp contact button.

**Exit criteria:** register → login → add to cart → place order → order appears in `/api/customers/orders` and in the admin panel with the customer attached.

---

## 8. Phase 5 — Deployment

**Estimate:** Day 6, ~2 hours

### 8.1 — `render.yaml`

```yaml
services:
  - type: web
    name: abu-rabie-backend
    env: node
    rootDir: backend          # ← becomes "." if public assets move to the repo root (Decision 2)
    plan: free
    buildCommand: npm ci --omit=dev
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 5000
      - key: MONGODB_URI
        sync: false
      - key: MONGO_DBNAME
        value: abu_rabie
      - key: JWT_SECRET
        generateValue: true
      - key: ADMIN_USERNAME
        value: admin
      - key: ADMIN_PASSWORD
        sync: false
      - key: WHATSAPP_NUMBER
        value: "201093044150"
      - key: CLIENT_URL
        sync: false          # pin the real Render origin after the first deploy
      - key: ALLOW_OFFLINE_MODE
        value: "false"
```

### 8.2 — First deploy procedure

1. `git push` the branch, create the Render Blueprint from `render.yaml`.
2. Fill in `MONGODB_URI` and `ADMIN_PASSWORD` in the dashboard.
3. Deploy; read logs and confirm `✅ MongoDB Connected`.
4. `curl https://<app>.onrender.com/api/health` → `database: "connected"`.
5. Set `CLIENT_URL` to the deployed origin; redeploy so CORS is pinned.
6. Log in at `/admin`, change the admin password.
7. Run the seeder locally against Atlas (`MONGODB_URI` pointing at the cluster) so the free service isn't occupied seeding.

### 8.3 — Upload storage caveat

Render's free plan has an ephemeral filesystem: **images uploaded from the admin panel are lost on every redeploy.** Documented, not solved. Migration to Cloudinary or S3 is future work.

### 8.4 — Header verification

```bash
curl -sI https://<app>.onrender.com | grep -iE 'strict-transport|content-security|x-content-type|referrer-policy'
```

**Exit criteria:** Site, admin, and API all serve from one URL; Mongo is genuinely connected; no fallback mode active.

---

## 9. Phase 6 — Verification

**Estimate:** Day 6, ~2 hours

The project has **no test framework**. Add a lightweight smoke suite using Node's built-in runner (`node --test`) rather than introducing Jest or Vitest.

```
backend/tests/smoke.test.js
  ✓ order-price-tamper-is-ignored       POST /api/orders with price: 1 → server price wins
  ✓ admin-endpoints-require-real-token  401 without a Mongo-issued JWT
  ✓ cors-rejects-foreign-origin         disallowed Origin → error
  ✓ pagination-exposes-totalPages       ?page=2 returns distinct, correct metadata
  ✓ regex-input-survives-metacharacters search="a|b(" does not throw
  ✓ customer-flow                       register → login → cart → order → my-orders
```

```json
"scripts": { "test": "node --test tests/" }
```

Manual browser pass:
- RTL layout and Arabic typography on `index.html`, `products.html`, `account.html`, `/admin`
- Catalog: search, filter, paginate, add to cart **from page 3**
- Cart: quantity, removal, totals, checkout → WhatsApp opens with a correct message
- Guest contact form → appears in the admin panel
- Admin: login, product edit, order status change, message mark-as-read
- Responsive at 390px, 768px, 1280px
- Hotlinked product images load without mixed-content or referrer errors

---

## 10. Open Decisions

| # | Question | Recommendation | Rationale |
|---|---|---|---|
| **1** | Delete offline mode entirely, or gate it behind `ALLOW_OFFLINE_MODE`? | **Gate it** | Closes vulnerabilities 1.2/1.3 while keeping no-Mongo local development possible. Full deletion is simpler but removes the dev convenience. |
| **2** | Move public files into `public/` to fix 1.7 cleanly? | **Yes** | Requires touching `server.js:58,61` and `render.yaml` `rootDir`. The alternative — an explicit path allowlist — is smaller but fragile. |
| **3** | Collapse ~100 scraped category strings into 4? | **4 seeded categories + `أخرى`** | 100 filter buttons are unusable. The seeder's top-4 mapping keeps the useful granularity. |
| **4** | `elkhalily_images.zip` (1,374 images, 203 MB) | **Delete locally; keep hotlinking** | No script in the repo produces or consumes it. Self-hosting is a separate project; today the catalog depends on `elkhalily.com` staying up. |
| **5** | `phoneVerified` with no SMS | **Accept; don't advertise "verified"** | A single-shop owner can confirm identity over WhatsApp. Adding SMS introduces a paid dependency. |

---

## 11. Accepted Residual Risks

| Risk | Mitigation |
|---|---|
| Render free sleeps after 15 min idle → ~50s cold start | Accept; unavoidable on the free plan |
| Atlas M0 free tier: 512 MB, sleeps after 10 min idle | ~826 products is a fraction of the limit |
| Uploaded images lost on redeploy | Documented; move to object storage before relying on uploads |
| Catalog depends on `elkhalily.com` staying available | Hotlinked images degrade to the logo fallback; self-hosting is backlog |
| Dataset contains a third party's product copy and photography | **Confirm licensing before launch** — worth a legal/commercial sanity check |
| No backups | Enable Atlas continuous backup before production data accumulates |

---

## 12. Execution Order

```
Phase 0  ──►  Phase 1  ──►  Phase 2  ──►  Phase 5  ──►  Phase 6
Foundation   Security      Atlas+Seed    Deploy      Verify
                                 │
                                 └──►  Phase 3 (Catalog)  ──┐
                                 └──►  Phase 4 (Accounts) ──┴─► both post-launch iterations
```

- **Blocking path:** 0 → 1 → 2 → 5 → 6. Do not deploy before Phase 1 and 2 are complete.
- Phases 3 and 4 need a live database, so they follow Phase 2. Phase 4 is technically independent and can slip without blocking launch — ship Phases 0–3 + 5 first, then add accounts.

### Total estimate

| Path | Effort |
|---|---|
| Minimum viable launch (Phases 0–2, 5, 6) | ~6 days |
| Full plan including catalog scale-up (Phase 3) | ~7 days |
| Full plan including customer accounts (Phase 4) | ~9 days |

---

## 13. Progress Tracker

| Phase | Status | Owner | Notes |
|---|---|---|---|
| 0 — Foundation | ⬜ Not started | | |
| 1 — Security | ⬜ Not started | | |
| 2 — Atlas & Seed | ⬜ Not started | | |
| 3 — Catalog | ⬜ Not started | | |
| 4 — Accounts | ⬜ Not started | | |
| 5 — Deploy | ⬜ Not started | | |
| 6 — Verify | ⬜ Not started | | |

**Legend:** ⬜ not started · 🟡 in progress · 🟢 complete · 🔴 blocked