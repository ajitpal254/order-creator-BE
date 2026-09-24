import { z } from 'zod';
import { ALL_ORDER_STATUSES } from '../utils/stateMachine.js';

/**
 * Higher-order middleware to validate incoming request data using Zod schemas
 * @param {Object} schemas - Object containing optional schemas: { body, query, params }
 */
export const validate = (schemas = {}) => {
  return async (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: formattedErrors,
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Invalid request payload',
        error: error.message,
      });
    }
  };
};

// Common Schemas
export const orderItemSchema = z.object({
  product: z.string().optional().nullable(),
  productName: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  size: z.string().default('Standard'),
  finish: z.string().default('Standard'),
  color: z.string().default('Standard'),
  brand: z.string().default('H.A. Overseas'),
  quantity: z.coerce.number().int().positive('Quantity must be at least 1'),
  unitPrice: z.coerce.number().nonnegative().optional(),
  packaging: z.string().default('Master Carton'),
  customMarking: z.string().default(''),
  itemNotes: z.string().default(''),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'Order must contain at least one item'),
  shippingMarks: z.string().optional(),
  specialInstructions: z.string().optional(),
  customerDetailsOverride: z
    .object({
      customerName: z.string().optional(),
      businessName: z.string().optional(),
      country: z.string().optional(),
      phoneNumber: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  status: z.enum(['Draft', 'Submitted']).optional().default('Submitted'),
  orderType: z.enum(['Order', 'Quote']).optional().default('Order'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD']).optional().default('USD'),
  incoterm: z.enum(['FOB', 'CIF', 'EXW']).optional().default('FOB'),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ALL_ORDER_STATUSES),
  note: z.string().optional(),
  adminNotes: z.string().optional(),
  cancellationReason: z.string().optional(),
  trackingNumber: z.string().optional(),
  carrierName: z.string().optional(),
});

export const signupSchema = z.object({
  customerName: z.string().min(2, 'Customer name must be at least 2 characters'),
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  country: z.string().min(2, 'Country is required'),
  phoneNumber: z.string().min(5, 'Valid phone number is required'),
  address: z.string().min(3, 'Address is required'),
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});

// Invoice Validation Schemas
export const invoiceItemInputSchema = z.object({
  product: z.string().optional().nullable(),
  productName: z.string().optional(),
  sku: z.string().optional(),
  description: z.string().optional(),
  hsnCode: z.string().optional(),
  quantity: z.coerce.number().int().positive('Quantity must be at least 1'),
  unit: z.string().optional().default('PCS'),
  unitPrice: z.coerce.number().nonnegative('Unit price cannot be negative'),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
});

export const createInvoiceSchema = z.object({
  orderId: z.string().optional().nullable(),
  docType: z
    .enum(['commercial_invoice', 'gst_invoice', 'proforma_invoice', 'standard_invoice', 'eway_bill'])
    .optional()
    .default('commercial_invoice'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD', 'INR']).optional().default('USD'),
  incoterm: z.enum(['FOB', 'CIF', 'EXW']).optional().default('FOB'),
  customerDetails: z
    .object({
      customerName: z.string().min(1, 'Customer name is required'),
      businessName: z.string().optional().default(''),
      country: z.string().optional().default(''),
      phoneNumber: z.string().optional().default(''),
      address: z.string().optional().default(''),
      email: z.string().optional().default(''),
      taxId: z.string().optional().default(''),
      stateCode: z.string().optional().default(''),
    })
    .optional(),
  discountType: z.enum(['percent', 'amount']).optional().default('amount'),
  discountValue: z.coerce.number().nonnegative().optional().default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
  items: z.array(invoiceItemInputSchema).optional(),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  countryOfDestination: z.string().optional(),
  portOfDischarge: z.string().optional(),
  shippingMarks: z.string().optional(),
  dueDate: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
  docType: z.enum(['commercial_invoice', 'gst_invoice', 'proforma_invoice', 'standard_invoice', 'eway_bill']).optional(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD', 'INR']).optional(),
  incoterm: z.enum(['FOB', 'CIF', 'EXW']).optional(),
  customerDetails: z
    .object({
      customerName: z.string().optional(),
      businessName: z.string().optional(),
      country: z.string().optional(),
      phoneNumber: z.string().optional(),
      address: z.string().optional(),
      email: z.string().optional(),
      taxId: z.string().optional(),
      stateCode: z.string().optional(),
    })
    .optional(),
  discountType: z.enum(['percent', 'amount']).optional(),
  discountValue: z.coerce.number().nonnegative().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  items: z.array(invoiceItemInputSchema).optional(),
  status: z.enum(['draft', 'sent']).optional(),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  shippingMarks: z.string().optional(),
  dueDate: z.string().optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
  paymentMethod: z
    .enum(['Wire Transfer', 'Letter of Credit (LC)', 'Credit Card', 'Bank Transfer', 'Cash', 'Other'])
    .optional()
    .default('Wire Transfer'),
  paymentDate: z.string().optional(),
  referenceNumber: z.string().optional().default(''),
  notes: z.string().optional().default(''),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(3, 'A valid reason (minimum 3 characters) is required to void an invoice'),
});

