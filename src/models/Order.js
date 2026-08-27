import mongoose from 'mongoose';

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
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    totalAmount: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: 'USD',
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
      enum: [
        'Draft',
        'Submitted',
        'Under Review',
        'Confirmed',
        'In Production',
        'Dispatched',
        'Completed',
        'Cancelled',
      ],
      default: 'Submitted',
    },
    adminNotes: {
      type: String,
      default: '',
    },
    timeline: [
      {
        status: String,
        updatedBy: String,
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

export const Order = mongoose.model('Order', orderSchema);
