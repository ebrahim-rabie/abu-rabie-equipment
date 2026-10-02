const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Contact = require('../models/Contact');
const offlineStore = require('../utils/offlineStore');
const { isDbConnected, dbUnavailable } = require('../utils/dbState');

// Cancelled orders are excluded: this is booked order value, not realised cash.
const REVENUE_MATCH = { status: { $ne: 'ملغي' } };

// @desc    Get dashboard summary statistics
// @route   GET /api/stats/dashboard
// @access  Private (Admin)
const getDashboardStats = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;

      const products = offlineStore.getProducts({ page: 1, limit: 100 });
      const orders = offlineStore.getOrders();
      const contacts = offlineStore.getContacts();

      const revenue = orders
        .filter((o) => o.status !== 'ملغي')
        .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      return res.json({
        success: true,
        data: {
          products: {
            total: products.total,
            inStock: products.products.filter((p) => p.inStock).length,
            outOfStock: products.products.filter((p) => !p.inStock).length,
          },
          categories: offlineStore.getCategories().length,
          orders: {
            total: orders.length,
            pending: orders.filter((o) => o.status === 'جديد').length,
            revenue,
          },
          contacts: { unread: contacts.filter((c) => !c.isRead).length },
          recentOrders: orders.slice(0, 5),
          recentContacts: contacts.slice(0, 5),
        },
        storageMode: 'local_fallback',
      });
    }

    const [
      totalProducts,
      inStockProducts,
      totalCategories,
      totalOrders,
      pendingOrders,
      unreadContacts,
      recentOrders,
      recentContacts,
      revenueResult,
    ] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ inStock: true }),
      Category.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ status: 'جديد' }),
      Contact.countDocuments({ isRead: false }),
      Order.find().sort({ createdAt: -1 }).limit(5),
      Contact.find().sort({ createdAt: -1 }).limit(5),
      Order.aggregate([
        { $match: REVENUE_MATCH },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
    ]);

    return res.json({
      success: true,
      data: {
        products: {
          total: totalProducts,
          inStock: inStockProducts,
          outOfStock: totalProducts - inStockProducts,
        },
        categories: totalCategories,
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          revenue: revenueResult.length > 0 ? revenueResult[0].total : 0,
        },
        contacts: { unread: unreadContacts },
        recentOrders,
        recentContacts,
      },
      storageMode: 'mongodb',
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getDashboardStats };