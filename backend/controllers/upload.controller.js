// @desc    Upload single image
// @route   POST /api/upload/image
// @access  Private (Admin)
const uploadSingle = (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'لم يتم اختيار أي ملف للرفع',
    });
  }

  // Construct accessible URL
  const protocol = req.protocol;
  const host = req.get('host');
  const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

  res.json({
    success: true,
    message: 'تم رفع الصورة بنجاح',
    data: {
      filename: req.file.filename,
      url: imageUrl,
      path: `/uploads/${req.file.filename}`,
    },
  });
};

// @desc    Upload multiple images (max 5)
// @route   POST /api/upload/images
// @access  Private (Admin)
const uploadMultiple = (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'لم يتم اختيار أي ملفات للرفع',
    });
  }

  const protocol = req.protocol;
  const host = req.get('host');

  const uploaded = req.files.map((file) => ({
    filename: file.filename,
    url: `${protocol}://${host}/uploads/${file.filename}`,
    path: `/uploads/${file.filename}`,
  }));

  res.json({
    success: true,
    message: `تم رفع ${uploaded.length} صور بنجاح`,
    data: uploaded,
  });
};

module.exports = {
  uploadSingle,
  uploadMultiple,
};
