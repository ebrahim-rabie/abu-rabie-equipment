const { getEnv } = require('../config/env');

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} جنيه`;

/**
 * Formats order details into a clean Arabic WhatsApp message and returns the
 * direct wa.me link.
 *
 * `order.totalAmount` is trusted here because the value rendered is the total
 * the server computed at checkout, not one supplied by the browser.
 */
function createWhatsAppOrderLink(order, phoneNumber) {
  const target = phoneNumber || getEnv().WHATSAPP_NUMBER;

  const itemsText = (order.items || [])
    .map(
      (item, idx) =>
        `${idx + 1}. *${item.name}*${item.sku ? `\n   الكود: ${item.sku}` : ''}\n   الكمية: ${item.quantity} × ${money(item.price)}`
    )
    .join('\n');

  const text = [
    '🛠️ *طلب جديد من موقع مركز أبو ربيع للمعدات* 🛠️',
    '━━━━━━━━━━━━━━━',
    `📋 *رقم الطلب:* ${order.orderNumber}`,
    `👤 *اسم العميل:* ${order.customerName}`,
    `📞 *رقم الهاتف:* ${order.customerPhone}`,
    `📍 *العنوان:* ${order.customerAddress}${
      order.governorate ? ` (${order.governorate})` : ''
    }`,
    '',
    '🛒 *المنتجات المطلوبة:*',
    itemsText,
    '',
    `💰 *الإجمالي:* *${money(order.totalAmount)}*`,
    order.notes ? `\n📝 *ملاحظات إضافية:* ${order.notes}` : '',
    '━━━━━━━━━━━━━━━',
    'شكرًا لتسوقكم مع مركز أبو ربيع للمعدات!',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const cleanNumber = String(target).replace(/\D/g, '');
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}

module.exports = { createWhatsAppOrderLink };