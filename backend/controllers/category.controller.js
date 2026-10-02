const Category = require('../models/Category');
const Product = require('../models/Product');
const offlineStore = require('../utils/offlineStore');
const { isDbConnected, dbUnavailable } = require('../utils/dbState');
const { escapeRegex } = require('../utils/escapeRegex');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
const getAllCategories = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const categories = offlineStore.getCategories();
      return res.json({
        success: true,
        count: categories.length,
        data: categories,
        storageMode: 'local_dataset_fallback',
      });
    }

    const query = req.query.all === 'true' ? {} : { isActive: true };
    const categories = await Category.find(query)
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const counts = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const countMap = counts.reduce((acc, curr) => {
      if (curr._id) acc[curr._id.toString()] = curr.count;
      return acc;
    }, {});

    const enriched = categories.map((cat) => ({
      ...cat,
      productCount: countMap[cat._id.toString()] || 0,
    }));

    return res.json({
      success: true,
      count: enriched.length,
      data: enriched,
      storageMode: 'mongodb',
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Get single category by slug or ID
// @route   GET /api/categories/:slug
// @access  Public
const getCategoryBySlug = async (req, res, next) => {
  try {
    const param = String(req.params.slug);

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const categories = offlineStore.getCategories();
      const cat = categories.find((c) => c.slug === param || c._id === param);
      if (!cat) {
        return res.status(404).json({ success: false, message: 'القسم غير موجود' });
      }
      return res.json({ success: true, data: cat });
    }

    let category = await Category.findOne({ slug: param });
    if (!category && OBJECT_ID.test(param)) {
      category = await Category.findById(param);
    }

    if (!category) {
      return res.status(404).json({ success: false, message: 'القسم غير موجود' });
    }

    return res.json({ success: true, data: category });
  } catch (error) {
    return next(error);
  }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private (Admin)
const createCategory = async (req, res, next) => {
  try {
    const { name, description, image, icon, sortOrder, isActive } = req.body;

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ success: false, message: 'اسم القسم مطلوب' });
    }

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      return res.status(201).json({
        success: true,
        message: 'لا يمكن إنشاء الأقسام في وضع التطوير المحلي بدون قاعدة بيانات',
      });
    }

    const category = await Category.create({
      name: String(name).trim().slice(0, 120),
      description: String(description || '').slice(0, 500),
      image,
      icon,
      sortOrder: Number(sortOrder) || 0,
      isActive: isActive !== undefined ? isActive !== false : true,
    });

    return res.status(201).json({
      success: true,
      message: 'تم إضافة القسم بنجاح',
      data: category,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private (Admin)
const updateCategory = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      return res.status(503).json({
        success: false,
        message: 'تعديل الأقسام يتطلب قاعدة بيانات',
      });
    }

    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.slug;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    const category = await Category.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!category) {
      return res.status(404).json({ success: false, message: 'القسم غير موجود' });
    }

    // Keep the denormalised categoryName on products in step with the category
    if (updateData.name) {
      await Product.updateMany(
        { category: category._id },
        { $set: { categoryName: category.name } }
      );
    }

    return res.json({
      success: true,
      message: 'تم تعديل القسم بنجاح',
      data: category,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private (Admin)
const deleteCategory = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      return res.status(503).json({
        success: false,
        message: 'حذف الأقسام يتطلب قاعدة بيانات',
      });
    }

    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ success: false, message: 'القسم غير موجود' });
    }

    const affected = await Product.countDocuments({ category: category._id });

    if (affected > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        success: false,
        message: `لا يمكن حذف القسم لاحتوائه على ${affected} منتج. انقل المنتجات أولاً أو أعد الطلب مع force=true.`,
      });
    }

    // Orphan the products rather than deleting them along with the category
    if (affected > 0) {
      await Product.updateMany(
        { category: category._id },
        { $unset: { category: 1 } }
      );
    }

    await category.deleteOne();

    return res.json({ success: true, message: 'تم حذف القسم بنجاح' });
  } catch (error) {
    return next(error);
  }
};

// Exported for the admin category search helper
module.exports = {
  getAllCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
};