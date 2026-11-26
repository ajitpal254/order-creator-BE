/**
 * Order (and Quote) — hand-written type-only mirror of src/models/Order.js.
 *
 * Hand-written for the stored entity: the Zod schemas in
 * src/middleware/validate.js cover *requests* (createOrderSchema,
 * updateOrderStatusSchema, the quote-workflow schemas) and are mirrored
 * with z.infer-derived input types in ./schemas.ts. The stored shape
 * below mirrors the Mongoose model, including server-computed totals,
 * snapshots and timeline that no request schema contains.
 *
 * There is no separate Quote model: a quote is an Order with
 * orderType === 'Quote' plus the FEAT-02 (v0.5) quote fields. `Quote`
 * below is that narrowed view.
 */
import type { IsoDateString, ObjectIdString, Timestamps } from './envelope.js';
/**
 * Order status union — the values of ORDER_STATES in
 * src/utils/stateMachine.js (ALL_ORDER_STATUSES), which the Order model's
 * `status` enum uses directly.
 */
export type OrderStatus = 'Draft' | 'Submitted' | 'Confirmed' | 'In Production' | 'Quality Check' | 'Shipped' | 'Delivered' | 'Closed' | 'Cancelled';
export type OrderType = 'Order' | 'Quote';
/** Currency enum on the stored Order model (narrower than the create-request enum, which also allows INR/CAD). */
export type OrderCurrency = 'USD' | 'EUR' | 'GBP' | 'AUD';
export type Incoterm = 'FOB' | 'CIF' | 'EXW';
/** approvalStatus enum (FEAT-10, v0.9 company spend approval). */
export type OrderApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';
/** quoteStatus enum (FEAT-02, v0.5) — deliberately separate from the order status state machine. */
export type QuoteStatus = 'open' | 'accepted' | 'declined';
/** Price/specification snapshot frozen on an item at submission. All fields optional in the model. */
export interface OrderItemSnapshot {
    basePrice?: number;
    weightKg?: number;
    pcsPerCarton?: number;
    tierDiscountPercent?: number;
    finishSurcharge?: number;
    laserMarkingCost?: number;
    packagingCost?: number;
}
/** Order item subdocument from src/models/Order.js. */
export interface OrderItem {
    _id: ObjectIdString;
    /** Ref to Product; may be absent/null. */
    product?: ObjectIdString | null;
    productName: string;
    sku: string;
    size: string;
    finish: string;
    color: string;
    brand: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    snapshot?: OrderItemSnapshot;
    packaging: string;
    customMarking: string;
    itemNotes: string;
}
/** Customer details snapshot stored on the order. All fields optional in the model. */
export interface OrderCustomerDetails {
    customerName?: string;
    businessName?: string;
    country?: string;
    phoneNumber?: string;
    address?: string;
    email?: string;
}
/** Counter-offer status enum from the counterOffer subdocument in src/models/Order.js. */
export type CounterOfferStatus = 'pending' | 'accepted' | 'declined';
/** One buyer/staff counter-offer against a quote (FEAT-02, v0.5). */
export interface CounterOffer {
    _id: ObjectIdString;
    by: ObjectIdString;
    byRole: string;
    amount: number;
    message: string;
    status: CounterOfferStatus;
    createdAt: IsoDateString;
}
/** One status-timeline entry on an order. */
export interface OrderTimelineEntry {
    _id: ObjectIdString;
    status: string;
    updatedBy: string;
    updatedAt: IsoDateString;
    note?: string;
}
/** Service-to-service invoice link stored on the order (not the Invoice entity itself). */
export interface OrderInvoiceLink {
    invoiceId: string | null;
    pdfUrl: string | null;
    status: string | null;
    isPending: boolean;
    lastAttemptAt: IsoDateString | null;
    error: string | null;
}
export interface Order extends Timestamps {
    _id: ObjectIdString;
    id?: ObjectIdString;
    orderNumber: string;
    orderType: OrderType;
    /** Ref to the owning User. */
    user: ObjectIdString;
    customerDetails?: OrderCustomerDetails;
    items: OrderItem[];
    totalQuantity: number;
    subtotalAmount: number;
    discountPercent: number;
    discountAmount: number;
    totalAmount: number;
    distributorTierSnapshot: string;
    currency: OrderCurrency;
    currencyRate: number;
    /** FEAT-04 (v0.5): FX rate locked at confirmation; null until locked. */
    fxRateLocked: number | null;
    baseCurrency: string | null;
    baseTotal: number | null;
    incoterm: Incoterm;
    estimatedWeightKg: number;
    estimatedCartons: number;
    shippingMarks: string;
    specialInstructions: string;
    status: OrderStatus;
    cancellationReason: string | null;
    /** FEAT-10 (v0.9): ref to Company, null for personal orders. */
    company: ObjectIdString | null;
    approvalStatus: OrderApprovalStatus;
    approvalBy: ObjectIdString | null;
    approvalAt: IsoDateString | null;
    approvalReason: string;
    quoteValidityDate: IsoDateString | null;
    quoteVersion: number;
    quoteStatus: QuoteStatus;
    quoteAcceptedAt: IsoDateString | null;
    quoteDeclineReason: string;
    counterOffers: CounterOffer[];
    trackingNumber: string | null;
    carrierName: string | null;
    trackingUrl: string | null;
    idempotencyKey: string | null;
    invoice?: OrderInvoiceLink;
    adminNotes: string;
    timeline: OrderTimelineEntry[];
}
/**
 * Quote — an Order with orderType 'Quote'. The quote flow lives on the
 * Order model (no separate Quote model exists); this alias narrows the
 * discriminator for consumers.
 */
export type Quote = Order & {
    orderType: 'Quote';
};
