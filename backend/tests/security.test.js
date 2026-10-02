const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startHarness, clearDatabase } = require('./harness');
const Admin = require('../models/Admin');
const Product = require('../models/Product');
const Category = require('../models/Category');

/**
 * Regression tests for the security issues found during the production review.
 * Each case maps to a numbered item in PRODUCTION_LAUNCH_PLAN.md.
 */

let h;

test.before(async () => {
  h = await startHarness();
  await clearDatabase();

  await Admin.create({
    username: 'testadmin',
    email: 'testadmin@aburabie.test',
    password: 'testpassword123',
    name: 'Test Admin',
    role: 'superadmin',
  });

  await Category.create({
    name: 'معدات كهربائية',
    slug: 'power-tools',
    description: 'اختبار',
    sortOrder: 1,
  });

  await Product.create([
    {
      name: 'شنيور دقاق 13 مم توتال 850 وات',
      sku: 'TG109136',
      brand: 'Total',
      categoryName: 'معدات كهربائية',
      price: 1850,
      salePrice: 1650,
      images: ['https://elkhalily.com/a.jpg'],
      inStock: true,
    },
    {
      name: 'صاروخ 4.5 بوصة بوش 750 وات',
      sku: 'GWS750',
      brand: 'BOSH',
      categoryName: 'معدات كهربائية',
      price: 2900,
      inStock: false,
    },
  ]);
});

test.after(async () => {
  await h.stop();
});

const login = async () => {
  const res = await h.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'testadmin', password: 'testpassword123' },
  });
  assert.equal(res.status, 200, `admin login failed: ${res.text}`);
  return res.body.data.token;
};

// ---------------------------------------------------------------------------
// 1.1  Order totals must come from the database, never from the request body.
// ---------------------------------------------------------------------------
test('order price tampering is ignored', async (t) => {
  await t.test('client-supplied price of 1 is replaced by the catalogue price', async () => {
    const product = await Product.findOne({ sku: 'TG109136' });

    const res = await h.request('/api/orders', {
      method: 'POST',
      body: {
        customerName: 'اختبار',
        customerPhone: '01012345678',
        customerAddress: 'القاهرة',
        items: [
          {
            productId: String(product._id),
            name: 'اسم مزيف',
            sku: 'FAKE',
            price: 1,
            quantity: 2,
          },
        ],
      },
    });

    assert.equal(res.status, 201, res.text);
    // Sale price 1650 x 2
    assert.equal(res.body.data.totalAmount, 3300);
    assert.equal(res.body.data.items[0].price, 1650);
    assert.equal(res.body.data.items[0].name, product.name, 'name must come from the DB');
    assert.equal(res.body.data.items[0].sku, 'TG109136', 'sku must come from the DB');
  });

  await t.test('a price of 0 cannot be used to obtain a free order', async () => {
    const product = await Product.findOne({ sku: 'TG109136' });

    const res = await h.request('/api/orders', {
      method: 'POST',
      body: {
        customerName: 'اختبار',
        customerPhone: '01012345678',
        customerAddress: 'القاهرة',
        items: [{ productId: String(product._id), price: 0, quantity: 1 }],
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.totalAmount, 1650);
  });

  await t.test('an out-of-stock product is rejected', async () => {
    const product = await Product.findOne({ sku: 'GWS750' });

    const res = await h.request('/api/orders', {
      method: 'POST',
      body: {
        customerName: 'اختبار',
        customerPhone: '01012345678',
        customerAddress: 'القاهرة',
        items: [{ productId: String(product._id), quantity: 1 }],
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /غير متوفر/);
  });

  await t.test('an unknown product id is rejected', async () => {
    const res = await h.request('/api/orders', {
      method: 'POST',
      body: {
        customerName: 'اختبار',
        customerPhone: '01012345678',
        customerAddress: 'القاهرة',
        items: [{ productId: '0123456789abcdef01234567', quantity: 1 }],
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /غير موجود/);
  });
});

// ---------------------------------------------------------------------------
// 1.2 / 1.3  No token is accepted unless it resolves to a real Admin record.
// ---------------------------------------------------------------------------
test('admin endpoints require a database-backed admin token', async (t) => {
  const token = await login();

  await t.test('a valid token grants access', async () => {
    const res = await h.request('/api/stats/dashboard', { token });
    assert.equal(res.status, 200, res.text);
  });

  await t.test('a token signed with the wrong secret is rejected', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: 'x' }, 'not-the-real-secret-at-all-32-chars', {
      expiresIn: '1h',
    });
    const res = await h.request('/api/stats/dashboard', { token: forged });
    assert.equal(res.status, 401);
  });

  await t.test('a correctly signed token for a nonexistent admin is rejected', async () => {
    // This is the exact bypass that existed before: any valid signature plus an
    // unknown id used to be upgraded to superadmin.
    const jwt = require('jsonwebtoken');
    const { TEST_JWT_SECRET } = require('./harness');
    const ghost = jwt.sign({ id: 'offline-admin-id' }, TEST_JWT_SECRET, {
      expiresIn: '1h',
    });
    const res = await h.request('/api/stats/dashboard', { token: ghost });
    assert.equal(res.status, 401, 'a ghost admin must not authenticate');
  });

  await t.test('environment credentials cannot log in once the database is up', async () => {
    const res = await h.request('/api/auth/login', {
      method: 'POST',
      body: { username: 'testadmin', password: 'testpassword123' },
    });
    // The account exists and is used by the rest of the suite, so a successful
    // login here must come from the collection, not from a fallback string.
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id !== 'offline-admin-id', true);
    assert.equal(res.body.data.id !== 'default-admin', true);
  });

  await t.test('a wrong password is rejected', async () => {
    const res = await h.request('/api/auth/login', {
      method: 'POST',
      body: { username: 'testadmin', password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// 1.4  CORS must reject foreign origins.
// ---------------------------------------------------------------------------
test('CORS rejects a foreign origin', async (t) => {
  await t.test('the configured origin is allowed', async () => {
    const res = await h.request('/api/products', {
      origin: 'https://shop.example.test',
    });
    assert.equal(res.status, 200);
  });

  await t.test('an unlisted origin is refused', async () => {
    const res = await h.request('/api/products', {
      origin: 'https://evil.example.com',
    });
    assert.notEqual(res.status, 200, 'a foreign origin must not receive data');
    assert.match(res.body?.message || '', /غير مسموح/);
  });

  await t.test('no Origin header is allowed', async () => {
    const res = await h.request('/api/products');
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// 1.5  Regex metacharacters in search input must not break or hang the query.
// ---------------------------------------------------------------------------
test('search survives regex metacharacters', async (t) => {
  for (const term of ['a|b(', '(', '[', '\\', '.*', '(a+)+$', 'شنيور']) {
    await t.test(`term: ${JSON.stringify(term)}`, async () => {
      const res = await h.request(`/api/products?search=${encodeURIComponent(term)}`);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.success, true);
    });
  }

  await t.test('admin order search also survives metacharacters', async () => {
    const token = await login();
    const res = await h.request('/api/orders?search=' + encodeURIComponent('a|b('), {
      token,
    });
    assert.equal(res.status, 200, res.text);
  });
});

// ---------------------------------------------------------------------------
// Pagination metadata the frontend depends on.
// ---------------------------------------------------------------------------
test('product pagination exposes correct metadata', async () => {
  const first = await h.request('/api/products?limit=1&page=1');
  assert.equal(first.status, 200);
  assert.equal(first.body.data.length, 1);
  assert.equal(first.body.total, 2);
  assert.equal(first.body.totalPages, 2);
  assert.equal(first.body.currentPage, 1);

  const second = await h.request('/api/products?limit=1&page=2');
  assert.equal(second.body.currentPage, 2);
  assert.notEqual(second.body.data[0]._id, first.body.data[0]._id);

  // limit is clamped so a caller cannot ask for the whole catalogue at once
  const clamped = await h.request('/api/products?limit=99999');
  assert.equal(clamped.status, 200);
});

// ---------------------------------------------------------------------------
// 1.7  The repository root must not be served.
// ---------------------------------------------------------------------------
test('sensitive repository files are not served', async (t) => {
  for (const p of [
    '/render.yaml',
    '/backend/.env.example',
    '/scrape_elkhalily.py',
    '/backend/server.js',
    '/backend/package.json',
    '/package.json',
  ]) {
    await t.test(p, async () => {
      const res = await h.request(p);
      assert.notEqual(res.status, 200, `${p} must not be publicly readable`);
    });
  }

  await t.test('the storefront itself is served', async () => {
    const res = await h.request('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /أبو ربيع/);
  });

  await t.test('every asset the storefront loads is allowlisted', async () => {
    // A file that is not on the allowlist silently 404s in the browser, which
    // breaks the page in a way no API test would catch.
    const required = [
      '/style.css',
      '/script.js',
      '/products.js',
      '/account.css',
      '/account.js',
      '/account.html',
      '/products.html',
      '/product.html',
      '/cart.html',
      '/cart.js',
      '/product-detail.js',
      '/cart.css',
      '/product-detail.css',
      '/favicon.svg',
    ];

    for (const p of required) {
      const res = await h.request(p);
      assert.equal(res.status, 200, `${p} must be served`);
    }
  });

  await t.test('directory traversal is refused', async () => {
    for (const p of [
      '/../backend/.env',
      '/..%2fbackend%2f.env',
      '/assets/../backend/.env',
    ]) {
      const res = await h.request(p);
      assert.notEqual(res.status, 200, `${p} must not be readable`);
    }
  });
});

test('robots and sitemap publish the public catalogue pages', async () => {
  const robots = await h.request('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.text, /Disallow: \/admin\//);
  assert.match(robots.text, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);

  const sitemap = await h.request('/sitemap.xml');
  assert.equal(sitemap.status, 200, sitemap.text);
  assert.match(sitemap.text, /<urlset/);
  assert.match(sitemap.text, /http:\/\/127\.0\.0\.1:\d+\/products\.html/);
  assert.match(sitemap.text, /product\.html\?slug=/);
});

// ---------------------------------------------------------------------------
// 1.8  The CSP must not lock the site out of its own assets.
// ---------------------------------------------------------------------------
test('the content security policy permits the assets the site actually uses', async (t) => {
  const res = await h.request('/');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'a CSP header must be present');

  // Header directive names are kebab-case (style-src); normalise to camelCase so
  // the assertions below read naturally.
  const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  const directives = Object.fromEntries(
    csp
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts.length > 1)
      .map(([name, ...values]) => [camel(name), values])
  );

  await t.test('the Font Awesome stylesheet host is allowed', async () => {
    assert.ok(
      directives.styleSrc.includes('https://cdnjs.cloudflare.com'),
      'the storefront loads its stylesheet from cdnjs, so style-src must include it'
    );
  });

  await t.test('the Font Awesome webfont host is allowed', async () => {
    assert.ok(
      directives.fontSrc.includes('https://cdnjs.cloudflare.com'),
      'Font Awesome webfonts are served from cdnjs and must be allowed by font-src'
    );
  });

  await t.test('the supplier image host is allowed', async () => {
    assert.ok(
      directives.imgSrc.includes('https://elkhalily.com'),
      'every seeded product image is hotlinked from the supplier'
    );
  });

  await t.test('the Google font hosts are allowed', async () => {
    assert.ok(directives.fontSrc.includes('https://fonts.gstatic.com'));
  });

  await t.test('inline and eval scripts stay blocked', async () => {
    assert.ok(
      !directives.scriptSrc.includes("'unsafe-inline'"),
      'inline scripts must not be permitted'
    );
    assert.ok(!directives.scriptSrc.includes("'unsafe-eval'"));
  });

  await t.test('the policy forbids framing and plugins', async () => {
    assert.deepEqual(directives.frameAncestors, ["'none'"]);
    assert.deepEqual(directives.objectSrc, ["'none'"]);
  });
});

test('admin contact rendering escapes submitted content and sanitizes phone links', () => {
  const adminScript = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'admin', 'admin.js'),
    'utf8'
  );
  assert.match(adminScript, /escapeHtml\(c\.name\)/);
  assert.match(adminScript, /escapeHtml\(c\.message\)/);
  assert.match(adminScript, /replace\(\/\\D\/g, ''\)/);
});

test('frontend controls do not rely on inline event handlers blocked by CSP', () => {
  const frontendDir = path.join(__dirname, '..', '..', 'frontend');
  const files = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (/\.(html|js)$/i.test(entry.name)) files.push(fullPath);
    }
  };
  collect(frontendDir);

  for (const file of files) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /\son(?:click|change|error|submit|load)=/i,
      `${path.relative(frontendDir, file)} must attach handlers through JavaScript`
    );
  }
});

test('storefront and admin mobile menus use accessible buttons', () => {
  const frontendDir = path.join(__dirname, '..', '..', 'frontend');
  for (const page of ['index.html', 'products.html', 'product.html', 'cart.html', 'account.html']) {
    const html = fs.readFileSync(path.join(frontendDir, page), 'utf8');
    assert.match(html, /<button[^>]*class="menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-navigation"/);
    assert.match(html, /<ul class="nav-links" id="site-navigation">/);
  }
  const admin = fs.readFileSync(path.join(frontendDir, 'admin', 'index.html'), 'utf8');
  assert.match(admin, /<button[^>]*id="admin-menu-toggle"[^>]*aria-controls="admin-sidebar"/);
});

// ---------------------------------------------------------------------------
// 1.8  The admin dashboard must survive the CSP it is served under.
// ---------------------------------------------------------------------------
test('the admin panel loads external assets only', async (t) => {
  const res = await h.request('/admin/');
  assert.equal(res.status, 200);

  await t.test('the dashboard has no inline script block', () => {
    // An inline <script> is blocked by the CSP above, which would disable the
    // whole panel with only a console error to show for it.
    const inline = res.text.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi);
    assert.equal(
      inline,
      null,
      'inline scripts are not permitted by the CSP; move the logic into admin.js'
    );
  });

  await t.test('the extracted script is served', async () => {
    const script = await h.request('/admin/admin.js');
    assert.equal(script.status, 200, 'admin/admin.js must exist and be served');
    assert.match(script.text, /API_BASE/);
  });
});
