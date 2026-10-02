const Contact = require('../models/Contact');
const offlineStore = require('../utils/offlineStore');
const { isDbConnected, dbUnavailable } = require('../utils/dbState');

const clean = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

// @desc    Submit contact message
// @route   POST /api/contacts
// @access  Public
const submitContact = async (req, res, next) => {
  try {
    const { name, phone, email, message } = req.body;

    if (!name || !phone || !message) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال الاسم، رقم الهاتف، والرسالة',
      });
    }

    if (clean(message, 2000).length < 5) {
      return res.status(400).json({
        success: false,
        message: 'نص الرسالة قصير جداً',
      });
    }

    const contactData = {
      name: clean(name, 120),
      phone: clean(phone, 40),
      email: clean(email, 160),
      message: clean(message, 2000),
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    let saved;
    if (isDbConnected()) {
      saved = await Contact.create(contactData);
    } else {
      if (dbUnavailable(res)) return;
      contactData._id = `contact-${Date.now()}`;
      saved = offlineStore.saveContact(contactData);
    }

    return res.status(201).json({
      success: true,
      message: 'تم إرسال رسالتك بنجاح! سيتواصل معك فريق مركز أبو ربيع قريباً.',
      data: saved,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Get all contact messages
// @route   GET /api/contacts
// @access  Private (Admin)
const getAllContacts = async (req, res, next) => {
  try {
    const { unreadOnly, page = 1, limit = 20 } = req.query;

    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      let contacts = offlineStore.getContacts();
      if (unreadOnly === 'true') {
        contacts = contacts.filter((c) => !c.isRead);
      }
      return res.json({
        success: true,
        total: contacts.length,
        unreadCount: contacts.filter((c) => !c.isRead).length,
        data: contacts,
        storageMode: 'local_json',
      });
    }

    const query = unreadOnly === 'true' ? { isRead: false } : {};
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [total, unreadCount, contacts] = await Promise.all([
      Contact.countDocuments(query),
      Contact.countDocuments({ isRead: false }),
      Contact.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
    ]);

    return res.json({
      success: true,
      total,
      unreadCount,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: contacts,
      storageMode: 'mongodb',
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Mark contact message as read
// @route   PUT /api/contacts/:id/read
// @access  Private (Admin)
const markAsRead = async (req, res, next) => {
  try {
    if (!isDbConnected()) {
      if (dbUnavailable(res)) return;
      const updated = offlineStore.markContactRead(req.params.id);
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: 'الرسالة غير موجودة' });
      }
      return res.json({
        success: true,
        message: 'تم تحديد الرسالة كمقروءة',
        data: updated,
      });
    }

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'الرسالة غير موجودة',
      });
    }

    return res.json({
      success: true,
      message: 'تم تحديد الرسالة كمقروءة',
      data: contact,
    });
  } catch (error) {
    return next(error);
  }
};

// @desc    Delete contact message
// @route   DELETE /api/contacts/:id
// @access  Private (Admin)
const deleteContact = async (req, res, next) => {
  try {
    if (isDbConnected()) {
      const deleted = await Contact.findByIdAndDelete(req.params.id);
      if (!deleted) {
        return res
          .status(404)
          .json({ success: false, message: 'الرسالة غير موجودة' });
      }
    } else if (dbUnavailable(res)) {
      return;
    }

    return res.json({ success: true, message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  submitContact,
  getAllContacts,
  markAsRead,
  deleteContact,
};