const Product = require('../models/Product');
const Category = require('../models/Category');
const offlineStore = require('../utils/offlineStore');
const { isDbConnected, dbUnavailable } = require('../utils/dbState');
const { escapeRegex } = require('../utils/escapeRegex');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const toBool = (value, fallback) => {
  if (value === undefined) return fallback;
  return value === true || value === 'true';
};

const toPrice = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// @desc    Get all products with filtering, search, pagination, and sorting
// @route   GET /api/products
// @access  Public
const getAllProducts = async (req, res, next) => {
  try {
    const {
      category,
      brand,
      search,
      inStock,
      isFeatured,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 24,
    } = req.query;

    // Graceful offline fallback if MongoDB is not connected (development only)
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;

      const result = offlineStore.getProducts({
        category,
        brand,
        search,
        inStock,
        sort,
        page,
        limit,
      });

      return res.json({
        success: true,
        count: result.products.length,
        total: result.total,
        totalPages: result.totalPages,
        currentPage: result.currentPage,
        brands: result.brands,
        data: result.products,
        storageMode: 'local_dataset_fallback',
      });
    }

    const query = {};

    // Category filter (accepts ID or slug or name)
    if (category && category !== 'all' && category !== 'الكل') {
      if (OBJECT_ID.test(String(category))) {
        query.category = category;
      } else {
        const foundCat = await Category.findOne({ slug: category });
        if (foundCat) {
          query.category = foundCat._id;
        } else {
          query.categoryName = new RegExp(escapeRegex(String(category)), 'i');
        }
      }
    }

    // Brand filter
    if (brand && brand !== 'all') {
      query.brand = new RegExp(`^${escapeRegex(String(brand))}$`, 'i');
    }

    // Stock filter
    if (inStock !== undefined) {
      query.inStock = toBool(inStock);
    }

    // Featured filter
    if (isFeatured !== undefined) {
      query.isFeatured = toBool(isFeatured);
    }

    // Price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Math.max(0, Number(minPrice) || 0);
      if (maxPrice) query.price.$lte = Math.max(0, Number(maxPrice) || 0);
    }

    // Text search. A regex is used rather than $text because the term arrives
    // partial (typeahead); the `product_search` text index backs the full-match
    // case and keeps exact queries cheap.
    if (search && String(search).trim()) {
      const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
      query.$or = [
        { name: regex },
        { description: regex },
        { sku: regex },
        { brand: regex },
        { categoryName: regex },
      ];
    }

    let sortOption = { sortOrder: 1, createdAt: -1 };
    if (sort === 'price-asc') sortOption = { price: 1 };
    else if (sort === 'price-desc') sortOption = { price: -1 };
    else if (sort === 'discount') sortOption = { discountPct: -1, price: 1 };
    else if (sort === 'name') sortOption = { name: 1 };
    else if (sort === 'newest') sortOption = { createdAt: -1 };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));

    const [total, products, brands] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .populate('category', 'name slug')
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Product.distinct('brand'),
    ]);

    return res.json({
      success: true,
      count: products.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      brands: brands.filter(Boolean),
      data: products,
      storageMode: 'mongodb',
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Get single product by slug or ID
// @route   GET /api/products/:slug
// @access  Public
const getProductBySlug = async (req, res, next) => {
  try {
    const param = String(req.params.slug);

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const prod = offlineStore.getProductBySlug(param);
      if (!prod) {
        return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
      }
      return res.json({
        success: true,
        data: prod,
        storageMode: 'local_dataset_fallback',
      });
    }

    let product = await Product.findOne({ slug: param.toLowerCase() }).populate(
      'category',
      'name slug'
    );

    if (!product && OBJECT_ID.test(param)) {
      product = await Product.findById(param).populate('category', 'name slug');
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'المنتج غير موجود',
      });
    }

    return res.json({ success: true, data: product, storageMode: 'mongodb' });
  } catch (error) {
    return next(error);
  }
};

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = async (req, res, next) => {
  try {
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 8));

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const all = offlineStore.getProducts({ page: 1, limit, sort: 'discount' });
      return res.json({
        success: true,
        count: all.products.length,
        data: all.products,
        storageMode: 'local_dataset_fallback',
      });
    }

    let products = await Product.find({ isFeatured: true, inStock: true })
      .populate('category', 'name slug')
      .sort({ discountPct: -1 })
      .limit(limit);

    if (products.length < 4) {
      products = await Product.find({ inStock: true })
        .sort({ discountPct: -1, createdAt: -1 })
        .limit(limit);
    }

    return res.json({ success: true, count: products.length, data: products });
  } catch (error) {
    return next(error);
  }
};

// @desc    Create new product
// @route   POST /api/products
// @access  Private (Admin)
const createProduct = async (req, res, next) => {
  try {
    const {
      name,
      description,
      sku,
      category,
      categoryName,
      brand,
      price,
      salePrice,
      image,
      images,
      inStock,
      isFeatured,
      specs,
    } = req.body;

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'اسم المنتج مطلوب ويجب ألا يقل عن حرفين',
      });
    }

    if (price === undefined || toPrice(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'سعر المنتج مطلوب ويجب أن يكون أكبر من صفر',
      });
    }

    const payload = {
      name: String(name).trim().slice(0, 250),
      description: String(description || '').slice(0, 5000),
      sku: String(sku || '').trim().slice(0, 120),
      brand: String(brand || 'أخرى').trim().slice(0, 120),
      price: toPrice(price),
      salePrice: salePrice ? toPrice(salePrice) : null,
      image: String(image || ''),
      images: Array.isArray(images) && images.length ? images : image ? [image] : [],
      inStock: toBool(inStock, true),
      isFeatured: toBool(isFeatured, false),
      specs: specs && typeof specs === 'object' ? specs : {},
    };

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const newProd = offlineStore.addProduct({
        ...payload,
        categoryName: categoryName || 'معدات عامة',
      });
      return res.status(201).json({
        success: true,
        message: 'تم إضافة المنتج بنجاح (وضع التطوير المحلي)',
        data: newProd,
      });
    }

    let catName = categoryName;
    if (category && !catName && OBJECT_ID.test(String(category))) {
      const cat = await Category.findById(category);
      if (cat) catName = cat.name;
    }

    const product = await Product.create({
      ...payload,
      category: category && OBJECT_ID.test(String(category)) ? category : null,
      categoryName: String(catName || 'معدات عامة').trim().slice(0, 150),
    });

    return res.status(201).json({
      success: true,
      message: 'تم إضافة المنتج بنجاح',
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Admin)
const updateProduct = async (req, res, next) => {
  try {
    const updateData = { ...req.body };

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      if (updateData.price !== undefined) updateData.price = toPrice(updateData.price);
      if (updateData.salePrice !== undefined) {
        updateData.salePrice = updateData.salePrice ? toPrice(updateData.salePrice) : null;
      }
      const updated = offlineStore.updateProduct(req.params.id, updateData);
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: 'المنتج غير موجود' });
      }
      return res.json({
        success: true,
        message: 'تم تحديث بيانات المنتج',
        data: updated,
      });
    }

    if (updateData.price !== undefined) {
      updateData.price = toPrice(updateData.price);
      if (updateData.price <= 0) {
        return res
          .status(400)
          .json({ success: false, message: 'السعر يجب أن يكون أكبر من صفر' });
      }
    }

    if (updateData.salePrice !== undefined) {
      updateData.salePrice = updateData.salePrice ? toPrice(updateData.salePrice) : null;
      if (updateData.salePrice && updateData.price) {
        updateData.discountPct =
          updateData.salePrice < updateData.price
            ? Math.round(
                ((updateData.price - updateData.salePrice) / updateData.price) * 100
              )
            : 0;
      } else {
        updateData.discountPct = 0;
      }
    }

    if (typeof updateData.name === 'string') {
      updateData.name = updateData.name.trim().slice(0, 250);
    }

    // These are server-managed and must not be writable through this endpoint
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.__v;

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate('category', 'name slug');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'المنتج غير موجود',
      });
    }

    return res.json({
      success: true,
      message: 'تم تحديث بيانات المنتج بنجاح',
      data: product,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Admin)
const deleteProduct = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const removed = offlineStore.deleteProduct(req.params.id);
      if (!removed) {
        return res
          .status(404)
          .json({ success: false, message: 'المنتج غير موجود' });
      }
      return res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
    }

    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'المنتج غير موجود',
      });
    }

    return res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getAllProducts,
  getProductBySlug,
  getFeaturedProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};