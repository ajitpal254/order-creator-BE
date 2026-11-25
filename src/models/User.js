import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    customerName: {
      type: String,
      required: [true, 'Customer Name is required'],
      trim: true,
    },
    businessName: {
      type: String,
      required: [true, 'Business Name is required'],
      trim: true,
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone Number is required'],
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
    // GST/Tax registration number for domestic GST invoices
    taxId: {
      type: String,
      default: '',
      trim: true,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [10, 'Password must be at least 10 characters'],
    },
    role: {
      type: String,
      enum: ['user', 'buyer', 'admin', 'sales_manager', 'production_supervisor', 'qc_inspector', 'shipping_officer', 'super_admin'],
      default: 'user',
    },
    distributorTier: {
      type: String,
      enum: ['Standard', 'Bronze', 'Silver', 'Gold', 'Platinum'],
      default: 'Standard',
    },
    // SEC-07 (v0.2): refresh tokens used to live here as plaintext in a
    // refreshTokens array. They now live as SHA-256 hashes in the
    // RefreshSession collection (src/models/RefreshSession.js). The field
    // is intentionally NOT declared anymore; existing documents that still
    // carry it are harmless — Mongoose (strict by default) simply ignores
    // the undeclared path on load/save.
    firebaseUid: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password helper
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export const User = mongoose.model('User', userSchema);
