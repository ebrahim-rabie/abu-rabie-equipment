const Order = require('../models/Order');
const Product = require('../models/Product');
const offlineStore = require('../utils/offlineStore');
const { createWhatsAppOrderLink } = require('../utils/whatsapp');
const { isDbConnected, dbUnavailable } = require('../utils/dbState');
const { escapeRegex } = require('../utils/escapeRegex');

const ORDER_STATUSES = ['جديد', 'قيد التنفيذ', 'تم الشحن', 'مكتمل', 'ملغي'];

const normalizePhone = (raw = '') => String(raw).replace(/[^\d+]/g, '');

const buildOrderNumber = () =>
  `ABU-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.floor(
    100 + Math.random() * 900
  )}`;

/**
 * Resolves the submitted line items against the catalogue and prices them
 * server-side.
 *
 * The client's `price`, `name`, and `sku` fields are ignored entirely: trusting
 * them would let any caller place a 8,000 EGP order for 1 EGP. Only
 * `productId` and `quantity` are honoured, and the effective price is always
 * `salePrice || price` from the stored document.
 */
const priceItems = async (items, ProductModel) => {
  const ids = items
    .map((item) => item.productId || item.product)
    .filter(Boolean)
    .map(String);

  const products = ids.length
    ? await ProductModel.find({ _id: { $in: ids } }).select(
        'name sku price salePrice inStock image'
      )
    : [];

  const byId = new Map(products.map((p) => [String(p._id), p]));
  const seen = new Set();

  let total = 0;

  return items.map((item) => {
    const productId = String(item.productId || item.product || '');
    const product = byId.get(productId);

    if (!product) {
      const error = new Error(
        `منتج غير موجود في الكتالوج: ${item.name || productId || 'غير معروف'}`
      );
      error.status = 400;
      throw error;
    }

    if (!product.inStock) {
      const error = new Error(`المنتج "${product.name}" غير متوفر حالياً`);
      error.status = 400;
      throw error;
    }

    const quantity = Math.min(
      99,
      Math.max(1, parseInt(item.quantity, 10) || 1)
    );

    // Merge duplicate lines for the same product instead of double counting
    if (seen.has(productId)) {
      const error = new Error(`المنتج "${product.name}" مكرر في نفس الطلب`);
      error.status = 400;
      throw error;
    }
    seen.add(productId);

    const price = product.salePrice || product.price;
    total += price * quantity;

    return {
      product: product._id,
      name: product.name,
      sku: product.sku || '',
      price,
      quantity,
      image: product.image || '',
    };
  });
};

// @desc    Create new order (public / checkout)
// @route   POST /api/orders
// @access  Public
const createOrder = async (req, res, next) => {
  try {
    const {
      customerName,
      customerPhone,
      customerAddress,
      governorate,
      items,
      notes,
    } = req.body;

    if (!customerName || !customerPhone || !customerAddress) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال اسم العميل، رقم الهاتف، وعنوان التوصيل',
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'سلة المشتريات فارغة، يرجى إضافة منتجات أولاً',
      });
    }

    if (items.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'الطلب يحتوي على عدد منتجات أكبر من المسموح',
      });
    }

    const phone = normalizePhone(customerPhone);
    if (phone.replace(/\D/g, '').length < 8) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف غير صالح',
      });
    }

    const orderNumber = buildOrderNumber();

    // ---------------------------------------------------------------------
    // MongoDB path: prices come from the database, never from the request.
    // ---------------------------------------------------------------------
    if (isDbConnected()) {
      const validatedItems = await priceItems(items, Product);
      const total = validatedItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      const savedOrder = await Order.create({
        orderNumber,
        customerName: String(customerName).trim().slice(0, 120),
        customerPhone: phone,
        customerAddress: String(customerAddress).trim().slice(0, 400),
        governorate: String(governorate || '').trim().slice(0, 120),
        items: validatedItems,
        totalAmount: total,
        notes: String(notes || '').trim().slice(0, 1000),
        status: 'جديد',
        user: req.user?._id || undefined,
      });

      return res.status(201).json({
        success: true,
        message: 'تم استلام طلبك بنجاح!',
        data: savedOrder,
        whatsappUrl: createWhatsAppOrderLink(savedOrder),
        storageMode: 'mongodb',
      });
    }

    // ---------------------------------------------------------------------
    // Development-only JSON fallback.
    // ---------------------------------------------------------------------
    if (dbUnavailable(res)) return;

    const validatedItems = await priceItems(items, offlineStore.asProductModel());
    const total = validatedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const savedOrder = offlineStore.saveOrder({
      _id: `ord-${Date.now()}`,
      orderNumber,
      customerName: String(customerName).trim().slice(0, 120),
      customerPhone: phone,
      customerAddress: String(customerAddress).trim().slice(0, 400),
      governorate: String(governorate || '').trim().slice(0, 120),
      items: validatedItems,
      totalAmount: total,
      notes: String(notes || '').trim().slice(0, 1000),
      status: 'جديد',
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json({
      success: true,
      message: 'تم استلام طلبك بنجاح!',
      data: savedOrder,
      whatsappUrl: createWhatsAppOrderLink(savedOrder),
      storageMode: 'local_json',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }
    return next(error);
  }
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private (Admin)
const getAllOrders = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;

      let orders = offlineStore.getOrders();
      if (status && status !== 'all') {
        orders = orders.filter((o) => o.status === status);
      }
      if (search) {
        const s = String(search).toLowerCase();
        orders = orders.filter(
          (o) =>
            String(o.orderNumber).toLowerCase().includes(s) ||
            String(o.customerName).toLowerCase().includes(s) ||
            String(o.customerPhone).includes(s)
        );
      }
      return res.json({
        success: true,
        count: orders.length,
        total: orders.length,
        totalPages: 1,
        currentPage: 1,
        data: orders,
        storageMode: 'local_json',
      });
    }

    const query = {};
    if (status && status !== 'all' && ORDER_STATUSES.includes(status)) {
      query.status = status;
    }
    if (search && String(search).trim()) {
      const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
      query.$or = [
        { orderNumber: regex },
        { customerName: regex },
        { customerPhone: regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    return res.json({
      success: true,
      count: orders.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: orders,
      storageMode: 'mongodb',
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Get single order by ID
// @route   GET /api/orders/:id
// @access  Private (Admin)
const getOrderById = async (req, res, next) => {
  try {
    let order;

    if (isDbConnected()) {
      order = await Order.findById(req.params.id);
    } else {
      if (dbUnavailable(res)) return;
      const orders = offlineStore.getOrders();
      order = orders.find(
        (o) => o._id === req.params.id || o.orderNumber === req.params.id
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'الطلب غير موجود',
      });
    }

    return res.json({
      success: true,
      data: order,
      whatsappUrl: createWhatsAppOrderLink(order),
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private (Admin)
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `الحالة غير صالحة. الحالات المتاحة: ${ORDER_STATUSES.join(', ')}`,
      });
    }

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const updated = offlineStore.updateOrderStatus(req.params.id, status);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
      }
      return res.json({
        success: true,
        message: `تم تحديث حالة الطلب إلى "${status}"`,
        data: updated,
      });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'الطلب غير موجود',
      });
    }

    return res.json({
      success: true,
      message: `تم تحديث حالة الطلب إلى "${status}"`,
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Delete order
// @route   DELETE /api/orders/:id
// @access  Private (Admin)
const deleteOrder = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      offlineStore.deleteOrder(req.params.id);
    } else {
      const order = await Order.findByIdAndDelete(req.params.id);
      if (!order) {
        return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
      }
    }

    return res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  deleteOrder,
  priceItems,
  ORDER_STATUSES,
  normalizePhone,
};