import mongoose from 'mongoose';

/**
 * OrderTemplate (FEAT-05, v0.5)
 *
 * A buyer-owned, reusable snapshot of order items. Created either from
 * an explicit items list or by snapshotting one of the buyer's own
 * orders (POST /api/templates), and turned back into a Draft order via
 * POST /api/templates/:id/create-order.
 *
 * The item subdocument shape intentionally duplicates the Order item
 * schema in src/models/Order.js (same fields/defaults) so template
 * items can be copied into a new Order unchanged, stored prices and
 * snapshots included.
 */
const templateItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  },
  productName: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    required: true,
  },
  size: {
    type: String,
    default: 'Standard',
  },
  finish: {
    type: String,
    default: 'Standard',
  },
  color: {
    type: String,
    default: 'Standard',
  },
  brand: {
    type: String,
    default: 'H.A. Overseas',
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
  },
  unitPrice: {
    type: Number,
    default: 0,
  },
  totalPrice: {
    type: Number,
    default: 0,
  },
  snapshot: {
    basePrice: Number,
    weightKg: Number,
    pcsPerCarton: Number,
    tierDiscountPercent: Number,
    finishSurcharge: Number,
    laserMarkingCost: Number,
    packagingCost: Number,
  },
  packaging: {
    type: String,
    default: 'Master Carton',
  },
  customMarking: {
    type: String,
    default: '',
  },
  itemNotes: {
    type: String,
    default: '',
  },
});

const orderTemplateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    items: [templateItemSchema],
  },
  { timestamps: true }
);

// Template lists filter { user } newest-first.
orderTemplateSchema.index({ user: 1, createdAt: -1 });

export const OrderTemplate = mongoose.model('OrderTemplate', orderTemplateSchema);
