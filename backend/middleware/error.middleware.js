const { isProduction } = require('../config/env');

const notFound = (req, res, next) => {
  const error = new Error(`المسار غير موجود - ${req.originalUrl}`);
  error.status = 404;
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  let statusCode = err.status || (res.statusCode === 200 ? 500 : res.statusCode);
  let message = err.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'العنصر المطلوب غير موجود (معرف غير صالح)';
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0];
    const fieldNames = {
      phone: 'رقم الهاتف',
      sku: 'كود التخزين',
      slug: 'الرابط',
      sourceId: 'معرف المصدر',
      orderNumber: 'رقم الطلب',
      username: 'اسم المستخدم',
      email: 'البريد الإلكتروني',
    };
    message = `القيمة المدخلة في حقل (${fieldNames[field] || field}) مستخدمة بالفعل`;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((val) => val.message)
      .join('، ');
  }

  // Body parser rejected malformed JSON or an oversized payload
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'صيغة البيانات المرسلة غير صحيحة';
  }

  if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'حجم البيانات المرسلة أكبر من المسموح';
  }

  // A rejected CORS origin arrives here as a plain Error
  if (/not allowed by CORS/i.test(message)) {
    statusCode = 403;
    message = 'مصدر الطلب غير مسموح به';
  }

  // Multer upload errors
  if (err.name === 'MulterError') {
    statusCode = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'حجم الصورة أكبر من 5 ميجابايت'
        : 'فشل رفع الملف';
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'حقل الملف غير متوقع';
  }

  // Unexpected failures are logged in full but reported generically, so
  // internal details never reach the browser in production.
  if (statusCode >= 500) {
    console.error(`❌ ${req.method} ${req.originalUrl}`, err);
    message = isProduction()
      ? 'حدث خطأ في الخادم، يرجى المحاولة بعد قليل'
      : message;
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: isProduction() ? null : err.stack,
  });
};

module.exports = { notFound, errorHandler };