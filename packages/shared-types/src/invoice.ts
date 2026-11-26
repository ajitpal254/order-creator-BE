/**
 * Invoice — hand-written TYPE-ONLY mirror of the stored fields in
 * src/models/Invoice.js.
 *
 * This file is types only: no invoice runtime code is imported, changed
 * or re-implemented here. The Zod schemas that exist for invoices cover
 * *requests* (createInvoiceSchema / updateInvoiceSchema /
 * recordPaymentSchema / voidInvoiceSchema in src/middleware/validate.js)
 * and are mirrored with z.infer-derived input types in ./schemas.ts;
 * the stored entity below mirrors the Mongoose model, including its
 * computed tax/total breakdown and payment-history subdocuments.
 */
import type { IsoDateString, ObjectIdString, Timestamps } from './envelope.js';

/** Status enum from src/models/Invoice.js. */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'void';

/** docType enum from src/models/Invoice.js. */
export type InvoiceDocType =
  | 'commercial_invoice'
  | 'gst_invoice'
  | 'proforma_invoice'
  | 'standard_invoice'
  | 'eway_bill';

/** Currency enum from src/models/Invoice.js. */
export type InvoiceCurrency = 'USD' | 'EUR' | 'GBP' | 'AUD' | 'INR' | 'CAD';

export type InvoiceDiscountType = 'percent' | 'amount';

/** paymentMethod enum on the invoice payment-history subdocument. */
export type InvoicePaymentMethod =
  | 'Wire Transfer'
  | 'Letter of Credit (LC)'
  | 'Credit Card'
  | 'Bank Transfer'
  | 'Cash'
  | 'Other';

/** Invoice line-item subdocument, with its stored per-line tax breakdown. */
export interface InvoiceItem {
  _id: ObjectIdString;
  product: ObjectIdString | null;
  productName: string;
  sku: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineNet: number;
  lineTax: number;
  lineTotal: number;
}

/** One recorded payment in the invoice's `payments` history. */
export interface InvoicePaymentRecord extends Timestamps {
  _id: ObjectIdString;
  paymentId: string;
  amount: number;
  paymentDate: IsoDateString;
  paymentMethod: InvoicePaymentMethod;
  referenceNumber: string;
  notes: string;
  recordedBy: string;
}

export interface InvoiceCustomerDetails {
  customerName: string;
  businessName: string;
  country: string;
  phoneNumber: string;
  address: string;
  email: string;
  taxId: string;
  stateCode: string;
}

export interface InvoiceSenderDetails {
  companyName: string;
  address: string;
  phoneNumber: string;
  email: string;
  gstin: string;
  iecNo: string;
  pan: string;
  stateCode: string;
}

export interface Invoice extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  invoiceNumber: string;
  invoiceTitle: string;
  docType: InvoiceDocType;
  status: InvoiceStatus;
  /** Ref to Order, or null for standalone invoices. */
  order: ObjectIdString | null;
  /** Ref to the owning User. */
  user: ObjectIdString;
  customerDetails: InvoiceCustomerDetails;
  senderDetails: InvoiceSenderDetails;
  items: InvoiceItem[];
  currency: InvoiceCurrency;
  currencyRate: number;
  incoterm: 'FOB' | 'CIF' | 'EXW';
  totalQuantity: number;
  subtotal: number;
  discountType: InvoiceDiscountType;
  discountValue: number;
  discountAmount: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  shippingCharges: number;
  isIgst: boolean;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  totalInWords: string;
  /** Payment history — refs into the invoice ledger (see also the standalone Payment entity in ./payment.ts). */
  payments: InvoicePaymentRecord[];
  // Export metadata
  countryOfOrigin: string;
  countryOfDestination: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  preCarriageBy: string;
  vesselFlightNo: string;
  shippingMarks: string;
  totalPackages: string;
  exportHeaderNote: string;
  exportDeclaration: string;
  invoiceDate: IsoDateString;
  dueDate: IsoDateString;
  notes: string;
  termsAndConditions: string;
  voidReason: string | null;
  voidedAt: IsoDateString | null;
  voidedBy: string | null;
}
