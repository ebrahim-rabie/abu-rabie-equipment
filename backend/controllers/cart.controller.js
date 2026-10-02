const Cart = require('../models/Cart');
const Product = require('../models/Product');

const MAX_QTY = 99;

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

/**
 * Loads the cart and resolves every line against the current catalogue.
 *
 * Prices are read from the Product collection here rather than stored on the
 * cart, so a stale cart always shows live prices. Lines whose product has been
 * deleted or is no longer purchasable are reported in `unavailable` instead of
 * being silently hidden, so the customer understands why their total changed.
 */
const hydrateCart = async (cart) => {
  const ids = cart.items.map((item) => item.product);
  const products = await Product.find({ _id: { $in: ids } })
    .select('name sku price salePrice discountPct image inStock')
    .lean();

  const byId = new Map(products.map((p) => [String(p._id), p]));

  const items = [];
  const unavailable = [];
  let total = 0;

  for (const item of cart.items) {
    const product = byId.get(String(item.product));

    if (!product || !product.inStock) {
      unavailable.push({
        productId: String(item.product),
        name: product ? product.name : 'منتج محذوف',
        reason: product ? 'غير متوفر حالياً' : 'لم يعد متاحاً',
      });
      continue;
    }

    const price = product.salePrice || product.price;
    const lineTotal = price * item.quantity;
    total += lineTotal;

    items.push({
      productId: String(item.product),
      name: product.name,
      sku: product.sku,
      price,
      discountPct: product.discountPct,
      image: product.image,
      quantity: item.quantity,
      lineTotal,
    });
  }

  return { items, unavailable, total };
};

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
};

const respond = async (res, cart, message) => {
  const payload = await hydrateCart(cart);
  return res.json({
    success: true,
    message,
    count: payload.items.reduce((sum, i) => sum + i.quantity, 0),
    total: payload.total,
    data: { ...payload, items: payload.items },
  });
};

// @desc    Get the signed-in customer's cart
// @route   GET /api/customers/cart
// @access  Private (Customer)
const getCart = async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user._id);
    const payload = await hydrateCart(cart);
    return res.json({
      success: true,
      count: payload.items.reduce((sum, i) => sum + i.quantity, 0),
      total: payload.total,
      data: payload,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Add a product to the cart
// @route   POST /api/customers/cart
// @access  Private (Customer)
const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity = 1 } = req.body;

    if (!productId) return fail(res, 400, 'يرجى تحديد المنتج');

    const product = await Product.findById(productId).select('name inStock');

    if (!product) return fail(res, 404, 'المنتج غير موجود');
    if (!product.inStock) return fail(res, 400, 'المنتج غير متوفر حالياً');

    const qty = Math.min(MAX_QTY, Math.max(1, parseInt(quantity, 10) || 1));

    const cart = await getOrCreateCart(req.user._id);
    const existing = cart.items.find((i) => String(i.product) === String(productId));

    if (existing) {
      existing.quantity = Math.min(MAX_QTY, existing.quantity + qty);
    } else {
      cart.items.push({ product: productId, quantity: qty });
    }

    await cart.save();

    return respond(res, cart, 'تمت إضافة المنتج إلى السلة');
  } catch (error) {
    return next(error);
  }
};

// @desc    Set the quantity of a cart line
// @route   PUT /api/customers/cart/:productId
// @access  Private (Customer)
const updateQuantity = async (req, res, next) => {
  try {
    const quantity = parseInt(req.body.quantity, 10);
    const cart = await getOrCreateCart(req.user._id);
    const existing = cart.items.find(
      (i) => String(i.product) === String(req.params.productId)
    );

    if (!existing) return fail(res, 404, 'المنتج غير موجود في السلة');

    if (!Number.isFinite(quantity) || quantity <= 0) {
      cart.items = cart.items.filter(
        (i) => String(i.product) !== String(req.params.productId)
      );
      await cart.save();
      return respond(res, cart, 'تم حذف المنتج من السلة');
    }

    existing.quantity = Math.min(MAX_QTY, quantity);
    await cart.save();

    return respond(res, cart, 'تم تحديث الكمية');
  } catch (error) {
    return next(error);
  }
};

// @desc    Remove a cart line
// @route   DELETE /api/customers/cart/:productId
// @access  Private (Customer)
const removeItem = async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user._id);
    cart.items = cart.items.filter(
      (i) => String(i.product) !== String(req.params.productId)
    );
    await cart.save();
    return respond(res, cart, 'تم حذف المنتج من السلة');
  } catch (error) {
    return next(error);
  }
};

// @desc    Empty the cart
// @route   DELETE /api/customers/cart
// @access  Private (Customer)
const clearCart = async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user._id);
    cart.items = [];
    await cart.save();
    return respond(res, cart, 'تم إفراغ السلة');
  } catch (error) {
    return next(error);
  }
};

// @desc    Merge a guest (localStorage) cart into the account cart on login
// @route   POST /api/customers/cart/merge
// @access  Private (Customer)
const mergeCart = async (req, res, next) => {
  try {
    const incoming = Array.isArray(req.body.items) ? req.body.items : [];

    if (incoming.length > 100) {
      return fail(res, 400, 'عدد المنتجات في السلة أكبر من المسموح');
    }

    const validIds = incoming
      .map((i) => i.id || i.productId)
      .filter(Boolean)
      .map(String);

    const products = await Product.find({ _id: { $in: validIds } })
      .select('name inStock')
      .lean();
    const known = new Map(products.map((p) => [String(p._id), p]));

    const cart = await getOrCreateCart(req.user._id);

    let added = 0;
    let skipped = 0;

    for (const raw of incoming) {
      const productId = String(raw.id || raw.productId || '');
      const product = known.get(productId);

      if (!product || !product.inStock) {
        skipped += 1;
        continue;
      }

      const qty = Math.min(MAX_QTY, Math.max(1, parseInt(raw.quantity, 10) || 1));
      const existing = cart.items.find((i) => String(i.product) === productId);

      if (existing) {
        existing.quantity = Math.min(MAX_QTY, existing.quantity + qty);
      } else {
        cart.items.push({ product: productId, quantity: qty });
        added += 1;
      }
    }

    await cart.save();

    const payload = await hydrateCart(cart);

    return res.json({
      success: true,
      message:
        skipped > 0
          ? `تم دمج السلة، وتعذر إضافة ${skipped} منتج (غير متوفر)`
          : 'تم دمج السلة بنجاح',
      added,
      skipped,
      count: payload.items.reduce((sum, i) => sum + i.quantity, 0),
      total: payload.total,
      data: payload,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCart,
  addToCart,
  updateQuantity,
  removeItem,
  clearCart,
  mergeCart,
  hydrateCart,
  getOrCreateCart,
};