/**
 * Zod request schemas + z.infer-derived input types.
 *
 * Source of truth in the backend: src/middleware/validate.js — the ONLY
 * place request/response Zod schemas live (src/utils/openapi.js derives
 * its request-body schemas from that same file; src/config/validateEnv.js
 * is env-only and intentionally out of scope).
 *
 * Why mirrored copies instead of importing the backend file? The schemas
 * in validate.js cannot be imported cleanly from this standalone package:
 * validate.js is JavaScript inside the backend's src/ tree, and importing
 * across the package boundary would drag backend module resolution (and
 * its `../utils/stateMachine.js` import) into a type-only package that
 * must build on its own. The schemas below are therefore faithful copies
 * of the validate.js definitions (same fields, same enums, same
 * defaults), and the exported types are derived from them with z.infer —
 * exactly the derivation the plan calls for. Keep them in sync with
 * validate.js when a request shape changes.
 *
 * Note: z.infer gives the schema's OUTPUT type (defaults applied), which
 * is what route handlers see after `validate()` has parsed the request.
 */
import { z } from 'zod';

/** ALL_ORDER_STATUSES from src/utils/stateMachine.js (ORDER_STATES values). */
export const ORDER_STATUS_VALUES = [
  'Draft',
  'Submitted',
  'Confirmed',
  'In Production',
  'Quality Check',
  'Shipped',
  'Delivered',
  'Closed',
  'Cancelled',
] as const;

// --- Orders ---------------------------------------------------------------

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
export type OrderItemInput = z.infer<typeof orderItemSchema>;

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
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD', 'INR', 'CAD']).optional().default('USD'),
  incoterm: z.enum(['FOB', 'CIF', 'EXW']).optional().default('FOB'),
  companyId: z.string().optional().nullable(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  note: z.string().optional(),
  adminNotes: z.string().optional(),
  cancellationReason: z.string().optional(),
  trackingNumber: z.string().optional(),
  carrierName: z.string().optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

// --- Quote workflow (FEAT-02, v0.5) ----------------------------------------

export const counterOfferSchema = z.object({
  amount: z.coerce.number().positive('Counter-offer amount must be greater than zero'),
  message: z.string().max(1000).optional().default(''),
});
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;

export const respondCounterOfferSchema = z.object({
  accept: z.boolean(),
  validityDays: z.coerce.number().int().positive().max(365).optional(),
  quoteValidityDate: z.string().datetime().optional(),
});
export type RespondCounterOfferInput = z.infer<typeof respondCounterOfferSchema>;

export const acceptQuoteSchema = z.object({});
export type AcceptQuoteInput = z.infer<typeof acceptQuoteSchema>;

export const declineQuoteSchema = z.object({
  reason: z.string().max(1000).optional().default(''),
});
export type DeclineQuoteInput = z.infer<typeof declineQuoteSchema>;

// --- Auth -------------------------------------------------------------------

export const signupSchema = z.object({
  customerName: z.string().min(2, 'Customer name must be at least 2 characters'),
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  country: z.string().min(2, 'Country is required'),
  phoneNumber: z.string().min(5, 'Valid phone number is required'),
  address: z.string().min(3, 'Address is required'),
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Please enter a valid email address'),
  // SEC-04 (v0.1): minimum password length is 10.
  password: z.string().min(10, 'Password must be at least 10 characters'),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

// --- Invoices (request inputs only — the stored Invoice type is in ./invoice.ts) ---

export const invoiceItemInputSchema = z.object({
  product: z.string().optional().nullable(),
  productName: z.string().optional(),
  sku: z.string().optional(),
  description: z.string().optional(),
  hsnCode: z.string().optional(),
  quantity: z.coerce.number().positive('Quantity or hours must be greater than 0'),
  unit: z.string().optional().default('PCS'),
  unitPrice: z.coerce.number().nonnegative('Unit price cannot be negative'),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;

export const createInvoiceSchema = z.object({
  orderId: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  invoiceTitle: z.string().optional().nullable(),
  docType: z
    .enum(['commercial_invoice', 'gst_invoice', 'proforma_invoice', 'standard_invoice', 'eway_bill'])
    .optional()
    .default('standard_invoice'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD', 'INR', 'CAD']).optional().default('USD'),
  incoterm: z.enum(['FOB', 'CIF', 'EXW']).optional().default('FOB'),
  customerDetails: z
    .object({
      customerName: z.string().optional().default(''),
      businessName: z.string().optional().default(''),
      country: z.string().optional().default(''),
      phoneNumber: z.string().optional().default(''),
      address: z.string().optional().default(''),
      email: z.string().optional().default(''),
      taxId: z.string().optional().default(''),
      stateCode: z.string().optional().default(''),
    })
    .optional(),
  senderDetails: z
    .object({
      companyName: z.string().optional().default(''),
      address: z.string().optional().default(''),
      phoneNumber: z.string().optional().default(''),
      phone: z.string().optional().default(''),
      email: z.string().optional().default(''),
      gstin: z.string().optional().default(''),
      iecNo: z.string().optional().default(''),
      pan: z.string().optional().default(''),
      stateCode: z.string().optional().default(''),
    })
    .optional(),
  discountType: z.enum(['percent', 'amount']).optional().default('amount'),
  discountValue: z.coerce.number().nonnegative().optional().default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
  shippingCharges: z.coerce.number().min(0).optional().default(0),
  items: z.array(invoiceItemInputSchema).optional(),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  countryOfDestination: z.string().optional(),
  portOfDischarge: z.string().optional(),
  shippingMarks: z.string().optional(),
  status: z.enum(['draft', 'sent']).optional(),
  invoiceDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  invoiceNumber: z.string().optional(),
  invoiceTitle: z.string().optional().nullable(),
  docType: z.enum(['commercial_invoice', 'gst_invoice', 'proforma_invoice', 'standard_invoice', 'eway_bill']).optional(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD', 'INR', 'CAD']).optional(),
  incoterm: z.enum(['FOB', 'CIF', 'EXW']).optional(),
  senderDetails: z
    .object({
      companyName: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      phoneNumber: z.string().optional(),
      email: z.string().optional(),
      gstin: z.string().optional(),
      pan: z.string().optional(),
      iecNo: z.string().optional(),
      stateCode: z.string().optional(),
    })
    .optional(),
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
  shippingCharges: z.coerce.number().min(0).optional(),
  items: z.array(invoiceItemInputSchema).optional(),
  status: z.enum(['draft', 'sent']).optional(),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  shippingMarks: z.string().optional(),
  invoiceDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

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
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().min(3, 'A valid reason (minimum 3 characters) is required to void an invoice'),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

// --- Templates & addresses (FEAT-05, v0.5) -----------------------------------

export const templateItemSchema = orderItemSchema.extend({
  totalPrice: z.coerce.number().nonnegative().optional(),
  snapshot: z
    .object({
      basePrice: z.coerce.number().optional(),
      weightKg: z.coerce.number().optional(),
      pcsPerCarton: z.coerce.number().optional(),
      tierDiscountPercent: z.coerce.number().optional(),
      finishSurcharge: z.coerce.number().optional(),
      laserMarkingCost: z.coerce.number().optional(),
      packagingCost: z.coerce.number().optional(),
    })
    .optional(),
});
export type TemplateItemInput = z.infer<typeof templateItemSchema>;

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  items: z.array(templateItemSchema).min(1, 'Template must contain at least one item').optional(),
  fromOrderId: z.string().min(1).optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const createAddressSchema = z.object({
  label: z.string().optional().default(''),
  type: z.enum(['bill-to', 'ship-to']).optional().default('ship-to'),
  line1: z.string().min(1, 'Address line 1 is required'),
  line2: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  country: z.string().optional().default(''),
  postalCode: z.string().optional().default(''),
});
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z.object({
  label: z.string().optional(),
  type: z.enum(['bill-to', 'ship-to']).optional(),
  line1: z.string().min(1, 'Address line 1 is required').optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
});
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
