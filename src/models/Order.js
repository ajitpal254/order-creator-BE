import mongoose from 'mongoose';
import { ALL_ORDER_STATUSES, ORDER_STATES } from '../utils/stateMachine.js';

const orderItemSchema = new mongoose.Schema({
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
  // Price & Specification Snapshots (Frozen at submission)
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

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    orderType: {
      type: String,
      enum: ['Order', 'Quote'],
      default: 'Order',
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customerDetails: {
      customerName: String,
      businessName: String,
      country: String,
      phoneNumber: String,
      address: String,
      email: String,
    },
    items: [orderItemSchema],
    totalQuantity: {
      type: Number,
      default: 0,
    },
    subtotalAmount: {
      type: Number,
      default: 0,
    },
    discountPercent: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    distributorTierSnapshot: {
      type: String,
      default: 'Standard',
    },
    currency: {
      type: String,
      enum: ['USD', 'EUR', 'GBP', 'AUD'],
      default: 'USD',
    },
    currencyRate: {
      type: Number,
      default: 1.0,
    },
    // FEAT-04 (v0.5): FX rate locked when the order is Confirmed —
    // additive snapshot only; the order's own totals are untouched.
    // fxRateLocked is the order-currency -> baseCurrency (USD) rate,
    // baseTotal is totalAmount converted at that rate (2dp).
    fxRateLocked: {
      type: Number,
      default: null,
    },
    baseCurrency: {
      type: String,
      default: null,
    },
    baseTotal: {
      type: Number,
      default: null,
    },
    incoterm: {
      type: String,
      enum: ['FOB', 'CIF', 'EXW'],
      default: 'FOB',
    },
    estimatedWeightKg: {
      type: Number,
      default: 0,
    },
    estimatedCartons: {
      type: Number,
      default: 0,
    },
    shippingMarks: {
      type: String,
      default: '',
    },
    specialInstructions: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ALL_ORDER_STATUSES,
      default: ORDER_STATES.SUBMITTED,
      index: true,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    trackingNumber: {
      type: String,
      default: null,
    },
    carrierName: {
      type: String,
      default: null,
    },
    trackingUrl: {
      type: String,
      default: null,
    },
    idempotencyKey: {
      type: String,
      default: null,
      index: true,
    },
    // Service-to-Service Invoicing (Phase A Connect)
    invoice: {
      invoiceId: { type: String, default: null },
      pdfUrl: { type: String, default: null },
      status: { type: String, default: null },
      isPending: { type: Boolean, default: false },
      lastAttemptAt: { type: Date, default: null },
      error: { type: String, default: null },
    },
    adminNotes: {
      type: String,
      default: '',
    },
    timeline: [
      {
        status: {
          type: String,
          required: true,
        },
        updatedBy: {
          type: String,
          required: true,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        note: String,
      },
    ],
  },
  { timestamps: true }
);

// QOL-07 indexes, matched to the query patterns in orderController.js:
// - getMyOrders / getAllOrders list by user and/or status, newest first
//   (filter { user } or { status }, sort { createdAt: -1 }).
// - getActiveDraft / getBuyerAnalytics filter by { user, status }.
// Single-field indexes on orderNumber (unique), user, status and
// orderType already exist on the fields above.
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ user: 1, status: 1 });

export const Order = mongoose.model('Order', orderSchema);
