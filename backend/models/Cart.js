const mongoose = require('mongoose');

/**
 * Server-side shopping cart for signed-in customers.
 *
 * Only the product reference and quantity are stored. Prices are always read
 * from the Product collection when the cart is rendered or checked out, so a
 * stale or tampered cart can never dictate what a customer pays.
 */
const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  quantity: {
    type: Number,
    min: [1, 'الكمية يجب أن تكون 1 على الأقل'],
    max: [99, 'الكمية يجب ألا تتجاوز 99'],
    default: 1,
  },
});

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

/** Total number of units held in the cart. */
cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

module.exports = mongoose.model('Cart', cartSchema);