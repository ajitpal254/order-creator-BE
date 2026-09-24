import mongoose from 'mongoose';

const paymentHistorySchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      default: () => `PAY-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Payment amount must be greater than zero'],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      enum: ['Wire Transfer', 'Letter of Credit (LC)', 'Credit Card', 'Bank Transfer', 'Cash', 'Other'],
      default: 'Wire Transfer',
    },
    referenceNumber: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
    recordedBy: {
      type: String,
      required: true,
    },
  },
  { _id: true, timestamps: true }
);

const invoiceItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null,
  },
  productName: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    default: 'N/A',
  },
  description: {
    type: String,
    default: '',
  },
  hsnCode: {
    type: String,
    default: '8205.59',
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
  },
  unit: {
    type: String,
    default: 'PCS',
  },
  unitPrice: {
    type: Number,
    required: true,
    min: [0, 'Unit price cannot be negative'],
  },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  taxRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  lineSubtotal: {
    type: Number,
    default: 0,
  },
  lineDiscount: {
    type: Number,
    default: 0,
  },
  lineNet: {
    type: Number,
    default: 0,
  },
  lineTax: {
    type: Number,
    default: 0,
  },
  lineTotal: {
    type: Number,
    default: 0,
  },
});

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    docType: {
      type: String,
      enum: ['commercial_invoice', 'gst_invoice', 'proforma_invoice', 'standard_invoice', 'eway_bill'],
      default: 'commercial_invoice',
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'partial', 'overdue', 'void'],
      default: 'draft',
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customerDetails: {
      customerName: { type: String, required: true },
      businessName: { type: String, default: '' },
      country: { type: String, default: '' },
      phoneNumber: { type: String, default: '' },
      address: { type: String, default: '' },
      email: { type: String, default: '' },
      taxId: { type: String, default: '' },
      stateCode: { type: String, default: '' },
    },
    senderDetails: {
      companyName: { type: String, default: () => process.env.SENDER_COMPANY_NAME || 'H.A. OVERSEAS' },
      address: { type: String, default: () => process.env.SENDER_ADDRESS || 'Industrial Area Phase-II, Ludhiana, Punjab - 141003, India' },
      phoneNumber: { type: String, default: () => process.env.SENDER_PHONE || '+91-99884-65800' },
      email: { type: String, default: () => process.env.SENDER_EMAIL || 'haoverseas1313@gmail.com' },
      gstin: { type: String, default: () => process.env.SENDER_GSTIN || '03AAAAA0000A1Z5' },
      iecNo: { type: String, default: () => process.env.SENDER_IEC_NO || '0300000000' },
      pan: { type: String, default: () => process.env.SENDER_PAN || 'AAAAA0000A' },
      stateCode: { type: String, default: () => process.env.SENDER_STATE_CODE || '03' },
    },
    items: [invoiceItemSchema],
    currency: {
      type: String,
      enum: ['USD', 'EUR', 'GBP', 'AUD', 'INR'],
      default: 'USD',
    },
    currencyRate: {
      type: Number,
      default: 1.0,
    },
    incoterm: {
      type: String,
      enum: ['FOB', 'CIF', 'EXW'],
      default: 'FOB',
    },
    totalQuantity: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    discountType: {
      type: String,
      enum: ['percent', 'amount'],
      default: 'amount',
    },
    discountValue: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    taxableAmount: {
      type: Number,
      default: 0,
    },
    taxRate: {
      type: Number,
      default: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    isIgst: {
      type: Boolean,
      default: true,
    },
    cgstAmount: {
      type: Number,
      default: 0,
    },
    sgstAmount: {
      type: Number,
      default: 0,
    },
    igstAmount: {
      type: Number,
      default: 0,
    },
    roundOff: {
      type: Number,
      default: 0,
    },
    grandTotal: {
      type: Number,
      default: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    totalInWords: {
      type: String,
      default: '',
    },
    payments: [paymentHistorySchema],

    // Export metadata
    countryOfOrigin: {
      type: String,
      default: 'India',
    },
    countryOfDestination: {
      type: String,
      default: '',
    },
    portOfLoading: {
      type: String,
      default: 'Any Port in India',
    },
    portOfDischarge: {
      type: String,
      default: '',
    },
    finalDestination: {
      type: String,
      default: '',
    },
    preCarriageBy: {
      type: String,
      default: 'By Road/Rail',
    },
    vesselFlightNo: {
      type: String,
      default: '',
    },
    shippingMarks: {
      type: String,
      default: '',
    },
    totalPackages: {
      type: String,
      default: '',
    },
    exportHeaderNote: {
      type: String,
      default: 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX',
    },
    exportDeclaration: {
      type: String,
      default: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    },
    invoiceDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Net 30 default
    },
    notes: {
      type: String,
      default: '',
    },
    termsAndConditions: {
      type: String,
      default: '1. Payment due within 30 days of invoice date.\n2. Goods once inspected and shipped under export bill of lading are non-returnable.\n3. Subject to Ludhiana, Punjab jurisdiction.',
    },
    voidReason: {
      type: String,
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

invoiceSchema.index({ user: 1, createdAt: -1 });
invoiceSchema.index({ order: 1 });
invoiceSchema.index({ status: 1 });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
