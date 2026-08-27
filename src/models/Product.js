import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'SKU / Item code is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    images: {
      type: [String],
      default: [],
    },
    basePrice: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    moq: {
      type: Number,
      default: 50,
      min: 1,
    },
    weightKg: {
      type: Number,
      default: 1.0,
    },
    pcsPerCarton: {
      type: Number,
      default: 20,
    },
    allowedSizes: {
      type: [String],
      default: [],
    },
    allowedFinishes: {
      type: [String],
      default: [],
    },
    allowedColors: {
      type: [String],
      default: [],
    },
    allowedBrands: {
      type: [String],
      default: [],
    },
    specifications: [
      {
        key: { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export const Product = mongoose.model('Product', productSchema);
