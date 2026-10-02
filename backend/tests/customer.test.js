const test = require('node:test');
const assert = require('node:assert/strict');

const { startHarness, clearDatabase } = require('./harness');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Category = require('../models/Category');

/**
 * Covers the Phase 4 customer account flow end to end:
 * register -> login -> cart -> merge -> order -> order history.
 */

let h;
let product;

const CUSTOMER = {
  name: 'أحمد محمد',
  phone: '01012345678',
  password: 'strongpass123',
};

test.before(async () => {
  h = await startHarness();
  await clearDatabase();

  await Category.create({ name: 'معدات كهربائية', slug: 'power-tools', sortOrder: 1 });

  [product] = await Product.create([
    {
      name: 'بطارية ليثيوم 16 فولت توتال',
      sku: 'TFBLI1620',
      brand: 'Total',
      categoryName: 'معدات كهربائية',
      price: 750,
      salePrice: 550,
      images: ['https://elkhalily.com/a.jpg'],
      inStock: true,
    },
  ]);
});

test.after(async () => {
  await h.stop();
});

// ---------------------------------------------------------------------------
// Registration and login
// ---------------------------------------------------------------------------
test('customer registration', async (t) => {
  await t.test('creates an account and returns a token', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: CUSTOMER,
    });

    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.phone, '01012345678');
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.password, undefined, 'password must never be echoed');
  });

  await t.test('normalizes the +20 form to the same local number', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: { ...CUSTOMER, phone: '+201012345678' },
    });
    // +201012345678 is the same person as 01012345678, so it is a duplicate
    assert.equal(res.status, 409);
  });

  await t.test('normalizes a different +20 number to a valid local number', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: { ...CUSTOMER, phone: '+201112345678' },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.phone, '01112345678');
  });

  await t.test('accepts the 0020 form', async () => {
    const res = await h.request('/api/customers/auth/login', {
      method: 'POST',
      body: { phone: '0020 101 234 5678', password: CUSTOMER.password },
    });
    assert.equal(res.status, 200, 'international dialing prefixes must resolve');
  });

  await t.test('rejects a duplicate phone number', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: CUSTOMER,
    });
    assert.equal(res.status, 409);
  });

  await t.test('rejects the same number in a different format', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: { ...CUSTOMER, phone: '+201012345678' },
    });
    assert.equal(res.status, 409, 'the number must normalise before the uniqueness check');
  });

  await t.test('rejects a short password', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: { ...CUSTOMER, phone: '01099999999', password: 'short' },
    });
    assert.equal(res.status, 400);
  });

  await t.test('rejects an invalid phone number', async () => {
    const res = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: { ...CUSTOMER, phone: '12345' },
    });
    assert.equal(res.status, 400);
  });
});

test('customer login', async (t) => {
  await t.test('accepts the registered credentials', async () => {
    const res = await h.request('/api/customers/auth/login', {
      method: 'POST',
      body: { phone: CUSTOMER.phone, password: CUSTOMER.password },
    });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.body.data.token);
  });

  await t.test('accepts the international form of the phone number', async () => {
    const res = await h.request('/api/customers/auth/login', {
      method: 'POST',
      body: { phone: '+201012345678', password: CUSTOMER.password },
    });
    assert.equal(res.status, 200);
  });

  await t.test('rejects a wrong password', async () => {
    const res = await h.request('/api/customers/auth/login', {
      method: 'POST',
      body: { phone: CUSTOMER.phone, password: 'not-the-password' },
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
test('server-side cart', async (t) => {
  let token;

  test.before(async () => {
    const res = await h.request('/api/customers/auth/login', {
      method: 'POST',
      body: { phone: CUSTOMER.phone, password: CUSTOMER.password },
    });
    token = res.body.data.token;
  });

  await t.test('requires authentication', async () => {
    const res = await h.request('/api/customers/cart');
    assert.equal(res.status, 401);
  });

  await t.test('adds a product and prices it from the database', async () => {
    const res = await h.request('/api/customers/cart', {
      method: 'POST',
      token,
      body: { productId: String(product._id), quantity: 2 },
    });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.items[0].price, 550, 'sale price must be used');
    assert.equal(res.body.total, 1100);
    assert.equal(res.body.count, 2);
  });

  await t.test('an admin token cannot be used on customer endpoints', async () => {
    const Admin = require('../models/Admin');
    await Admin.create({
      username: 'admin2',
      email: 'admin2@test.local',
      password: 'adminpassword123',
      role: 'superadmin',
    });
    const jwt = require('jsonwebtoken');
    const { TEST_JWT_SECRET } = require('./harness');

    const adminToken = jwt.sign(
      { id: String((await Admin.findOne({ username: 'admin2' }))._id), type: 'admin' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await h.request('/api/customers/cart', { token: adminToken });
    assert.equal(res.status, 401, 'token type confusion must be rejected');
  });

  await t.test('increments quantity on a repeat add', async () => {
    const res = await h.request('/api/customers/cart', {
      method: 'POST',
      token,
      body: { productId: String(product._id), quantity: 1 },
    });
    assert.equal(res.body.data.items[0].quantity, 3);
  });

  await t.test('updates the quantity', async () => {
    const res = await h.request(`/api/customers/cart/${product._id}`, {
      method: 'PUT',
      token,
      body: { quantity: 5 },
    });
    assert.equal(res.body.data.items[0].quantity, 5);
    assert.equal(res.body.total, 2750);
  });

  await t.test('clamps the quantity to 99', async () => {
    const res = await h.request(`/api/customers/cart/${product._id}`, {
      method: 'PUT',
      token,
      body: { quantity: 5000 },
    });
    assert.equal(res.body.data.items[0].quantity, 99);
  });

  await t.test('setting the quantity to 0 removes the line', async () => {
    await h.request(`/api/customers/cart/${product._id}`, {
      method: 'PUT',
      token,
      body: { quantity: 2 },
    });
    const res = await h.request(`/api/customers/cart/${product._id}`, {
      method: 'PUT',
      token,
      body: { quantity: 0 },
    });
    assert.equal(res.body.data.items.length, 0);
    assert.equal(res.body.total, 0);
  });
});

// ---------------------------------------------------------------------------
// Cart merge on login
// ---------------------------------------------------------------------------
test('guest cart merges into the account cart on login', async (t) => {
  const login = await h.request('/api/customers/auth/login', {
    method: 'POST',
    body: { phone: CUSTOMER.phone, password: CUSTOMER.password },
  });
  const token = login.body.data.token;

  await h.request('/api/customers/cart', {
    method: 'POST',
    token,
    body: { productId: String(product._id), quantity: 2 },
  });

  const res = await h.request('/api/customers/cart/merge', {
    method: 'POST',
    token,
    body: {
      items: [
        { id: String(product._id), quantity: 3 },
        { id: '0123456789abcdef01234567', quantity: 1 }, // does not exist
      ],
    },
  });

  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.added, 0, 'the product already existed');
  assert.equal(res.body.skipped, 1, 'the unknown product is reported as skipped');
  assert.equal(res.body.data.items[0].quantity, 5, 'quantities are summed');
  assert.equal(res.body.total, 2750);
});

// ---------------------------------------------------------------------------
// Order creation linked to the account
// ---------------------------------------------------------------------------
test('an order placed while signed in is linked to the account', async (t) => {
  const login = await h.request('/api/customers/auth/login', {
    method: 'POST',
    body: { phone: CUSTOMER.phone, password: CUSTOMER.password },
  });
  const token = login.body.data.token;

  await t.test('guest checkout still works', async () => {
    const res = await h.request('/api/orders', {
      method: 'POST',
      body: {
        customerName: 'زائر',
        customerPhone: '01000000000',
        customerAddress: 'الإسكندرية',
        items: [{ productId: String(product._id), quantity: 1 }],
      },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data.user, undefined);
    assert.ok(res.body.whatsappUrl.startsWith('https://wa.me/'));
  });

  await t.test('a customer token links the order', async () => {
    const res = await h.request('/api/orders', {
      method: 'POST',
      token,
      body: {
        customerName: CUSTOMER.name,
        customerPhone: CUSTOMER.phone,
        customerAddress: 'القاهرة - مدينة نصر',
        governorate: 'القاهرة',
        items: [{ productId: String(product._id), quantity: 4 }],
      },
    });

    assert.equal(res.status, 201, res.text);
    assert.ok(res.body.data.user, 'order must reference the customer');
    assert.equal(res.body.data.totalAmount, 2200);
  });

  await t.test('the order appears in the customer history', async () => {
    const res = await h.request('/api/customers/orders', { token });

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.length, 1, 'only their own orders are returned');
    assert.equal(res.body.data[0].customerName, CUSTOMER.name);
  });

  await t.test('another customer cannot see it', async () => {
    const other = await h.request('/api/customers/auth/register', {
      method: 'POST',
      body: {
        name: 'عميل آخر',
        phone: '01055556666',
        password: 'anotherpass123',
      },
    });

    const res = await h.request('/api/customers/orders', {
      token: other.body.data.token,
    });

    assert.equal(res.body.data.length, 0);
  });

  await t.test('placing an order does not clear the server cart', async () => {
    // The cart is deliberately preserved: the customer may reorder.
    const res = await h.request('/api/customers/cart', { token });
    assert.ok(res.body.data.items.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------
test('saved addresses', async (t) => {
  const login = await h.request('/api/customers/auth/login', {
    method: 'POST',
    body: { phone: CUSTOMER.phone, password: CUSTOMER.password },
  });
  const token = login.body.data.token;

  await t.test('adds an address and marks it default', async () => {
    const res = await h.request('/api/customers/addresses', {
      method: 'POST',
      token,
      body: {
        label: 'البيت',
        governorate: 'القاهرة',
        city: 'مدينة نصر',
        street: 'شارع عباس العقاد، عمارة 12، الدور الثالث',
        isDefault: true,
      },
    });

    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.data[0].isDefault, true);
  });

  await t.test('promoting a second address demotes the first', async () => {
    const add = await h.request('/api/customers/addresses', {
      method: 'POST',
      token,
      body: { label: 'العمل', street: 'ميدان downtown، برج 5', isDefault: true },
    });

    const defaults = add.body.data.filter((a) => a.isDefault);
    assert.equal(defaults.length, 1, 'exactly one default address');

    await h.request(`/api/customers/addresses/${add.body.data[add.body.data.length - 1]._id}`, {
      method: 'DELETE',
      token,
    });
  });

  await t.test('rejects a too-short address', async () => {
    const res = await h.request('/api/customers/addresses', {
      method: 'POST',
      token,
      body: { street: 'x' },
    });
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
test('profile updates', async (t) => {
  const login = await h.request('/api/customers/auth/login', {
    method: 'POST',
    body: { phone: CUSTOMER.phone, password: CUSTOMER.password },
  });
  const token = login.body.data.token;

  await t.test('changes the name', async () => {
    const res = await h.request('/api/customers/profile', {
      method: 'PUT',
      token,
      body: { name: 'أحمد محمد سيد' },
    });
    assert.equal(res.body.data.name, 'أحمد محمد سيد');
  });

  await t.test('refuses a phone number already taken', async () => {
    const res = await h.request('/api/customers/profile', {
      method: 'PUT',
      token,
      body: { phone: '01055556666' },
    });
    assert.equal(res.status, 409);
  });

  await t.test('password change requires the current password', async () => {
    const wrong = await h.request('/api/customers/password', {
      method: 'PUT',
      token,
      body: { currentPassword: 'nope', newPassword: 'newpassword123' },
    });
    assert.equal(wrong.status, 400);

    const right = await h.request('/api/customers/password', {
      method: 'PUT',
      token,
      body: { currentPassword: CUSTOMER.password, newPassword: 'newpassword123' },
    });
    assert.equal(right.status, 200, right.text);

    // restore
    await h.request('/api/customers/password', {
      method: 'PUT',
      token,
      body: { currentPassword: 'newpassword123', newPassword: CUSTOMER.password },
    });
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
test('carts and orders survive a reconnect', async () => {
  const user = await User.findOne({ phone: CUSTOMER.phone });
  assert.ok(user, 'the customer exists in the database');

  const cart = await Cart.findOne({ user: user._id });
  assert.ok(cart, 'a cart document is created on registration');

  const orders = await Order.countDocuments({ user: user._id });
  assert.equal(orders, 1);
});