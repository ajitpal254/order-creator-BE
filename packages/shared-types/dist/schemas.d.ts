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
export declare const ORDER_STATUS_VALUES: readonly ["Draft", "Submitted", "Confirmed", "In Production", "Quality Check", "Shipped", "Delivered", "Closed", "Cancelled"];
export declare const orderItemSchema: z.ZodObject<{
    product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    productName: z.ZodString;
    sku: z.ZodString;
    size: z.ZodDefault<z.ZodString>;
    finish: z.ZodDefault<z.ZodString>;
    color: z.ZodDefault<z.ZodString>;
    brand: z.ZodDefault<z.ZodString>;
    quantity: z.ZodCoercedNumber<unknown>;
    unitPrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    packaging: z.ZodDefault<z.ZodString>;
    customMarking: z.ZodDefault<z.ZodString>;
    itemNotes: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export declare const createOrderSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        productName: z.ZodString;
        sku: z.ZodString;
        size: z.ZodDefault<z.ZodString>;
        finish: z.ZodDefault<z.ZodString>;
        color: z.ZodDefault<z.ZodString>;
        brand: z.ZodDefault<z.ZodString>;
        quantity: z.ZodCoercedNumber<unknown>;
        unitPrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        packaging: z.ZodDefault<z.ZodString>;
        customMarking: z.ZodDefault<z.ZodString>;
        itemNotes: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    shippingMarks: z.ZodOptional<z.ZodString>;
    specialInstructions: z.ZodOptional<z.ZodString>;
    customerDetailsOverride: z.ZodOptional<z.ZodObject<{
        customerName: z.ZodOptional<z.ZodString>;
        businessName: z.ZodOptional<z.ZodString>;
        country: z.ZodOptional<z.ZodString>;
        phoneNumber: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        Draft: "Draft";
        Submitted: "Submitted";
    }>>>;
    orderType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        Order: "Order";
        Quote: "Quote";
    }>>>;
    currency: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        USD: "USD";
        EUR: "EUR";
        GBP: "GBP";
        AUD: "AUD";
        INR: "INR";
        CAD: "CAD";
    }>>>;
    incoterm: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        FOB: "FOB";
        CIF: "CIF";
        EXW: "EXW";
    }>>>;
    companyId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export declare const updateOrderStatusSchema: z.ZodObject<{
    status: z.ZodEnum<{
        Draft: "Draft";
        Submitted: "Submitted";
        Confirmed: "Confirmed";
        "In Production": "In Production";
        "Quality Check": "Quality Check";
        Shipped: "Shipped";
        Delivered: "Delivered";
        Closed: "Closed";
        Cancelled: "Cancelled";
    }>;
    note: z.ZodOptional<z.ZodString>;
    adminNotes: z.ZodOptional<z.ZodString>;
    cancellationReason: z.ZodOptional<z.ZodString>;
    trackingNumber: z.ZodOptional<z.ZodString>;
    carrierName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export declare const counterOfferSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;
export declare const respondCounterOfferSchema: z.ZodObject<{
    accept: z.ZodBoolean;
    validityDays: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    quoteValidityDate: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RespondCounterOfferInput = z.infer<typeof respondCounterOfferSchema>;
export declare const acceptQuoteSchema: z.ZodObject<{}, z.core.$strip>;
export type AcceptQuoteInput = z.infer<typeof acceptQuoteSchema>;
export declare const declineQuoteSchema: z.ZodObject<{
    reason: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type DeclineQuoteInput = z.infer<typeof declineQuoteSchema>;
export declare const signupSchema: z.ZodObject<{
    customerName: z.ZodString;
    businessName: z.ZodString;
    country: z.ZodString;
    phoneNumber: z.ZodString;
    address: z.ZodString;
    username: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type SignupInput = z.infer<typeof signupSchema>;
export declare const loginSchema: z.ZodObject<{
    usernameOrEmail: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type LoginInput = z.infer<typeof loginSchema>;
export declare const invoiceItemInputSchema: z.ZodObject<{
    product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    productName: z.ZodOptional<z.ZodString>;
    sku: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    hsnCode: z.ZodOptional<z.ZodString>;
    quantity: z.ZodCoercedNumber<unknown>;
    unit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    unitPrice: z.ZodCoercedNumber<unknown>;
    discountPercent: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    taxRate: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;
export declare const createInvoiceSchema: z.ZodObject<{
    orderId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    invoiceNumber: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    invoiceTitle: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    docType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        commercial_invoice: "commercial_invoice";
        gst_invoice: "gst_invoice";
        proforma_invoice: "proforma_invoice";
        standard_invoice: "standard_invoice";
        eway_bill: "eway_bill";
    }>>>;
    currency: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        USD: "USD";
        EUR: "EUR";
        GBP: "GBP";
        AUD: "AUD";
        INR: "INR";
        CAD: "CAD";
    }>>>;
    incoterm: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        FOB: "FOB";
        CIF: "CIF";
        EXW: "EXW";
    }>>>;
    customerDetails: z.ZodOptional<z.ZodObject<{
        customerName: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        businessName: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        country: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        phoneNumber: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        address: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        email: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        taxId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        stateCode: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>;
    senderDetails: z.ZodOptional<z.ZodObject<{
        companyName: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        address: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        phoneNumber: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        phone: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        email: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        gstin: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        iecNo: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        pan: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        stateCode: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>;
    discountType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        percent: "percent";
        amount: "amount";
    }>>>;
    discountValue: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    taxRate: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    shippingCharges: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    items: z.ZodOptional<z.ZodArray<z.ZodObject<{
        product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        productName: z.ZodOptional<z.ZodString>;
        sku: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        hsnCode: z.ZodOptional<z.ZodString>;
        quantity: z.ZodCoercedNumber<unknown>;
        unit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        unitPrice: z.ZodCoercedNumber<unknown>;
        discountPercent: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        taxRate: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    }, z.core.$strip>>>;
    notes: z.ZodOptional<z.ZodString>;
    termsAndConditions: z.ZodOptional<z.ZodString>;
    countryOfDestination: z.ZodOptional<z.ZodString>;
    portOfDischarge: z.ZodOptional<z.ZodString>;
    shippingMarks: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        draft: "draft";
        sent: "sent";
    }>>;
    invoiceDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    dueDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export declare const updateInvoiceSchema: z.ZodObject<{
    invoiceNumber: z.ZodOptional<z.ZodString>;
    invoiceTitle: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    docType: z.ZodOptional<z.ZodEnum<{
        commercial_invoice: "commercial_invoice";
        gst_invoice: "gst_invoice";
        proforma_invoice: "proforma_invoice";
        standard_invoice: "standard_invoice";
        eway_bill: "eway_bill";
    }>>;
    currency: z.ZodOptional<z.ZodEnum<{
        USD: "USD";
        EUR: "EUR";
        GBP: "GBP";
        AUD: "AUD";
        INR: "INR";
        CAD: "CAD";
    }>>;
    incoterm: z.ZodOptional<z.ZodEnum<{
        FOB: "FOB";
        CIF: "CIF";
        EXW: "EXW";
    }>>;
    senderDetails: z.ZodOptional<z.ZodObject<{
        companyName: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
        phone: z.ZodOptional<z.ZodString>;
        phoneNumber: z.ZodOptional<z.ZodString>;
        email: z.ZodOptional<z.ZodString>;
        gstin: z.ZodOptional<z.ZodString>;
        pan: z.ZodOptional<z.ZodString>;
        iecNo: z.ZodOptional<z.ZodString>;
        stateCode: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    customerDetails: z.ZodOptional<z.ZodObject<{
        customerName: z.ZodOptional<z.ZodString>;
        businessName: z.ZodOptional<z.ZodString>;
        country: z.ZodOptional<z.ZodString>;
        phoneNumber: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
        email: z.ZodOptional<z.ZodString>;
        taxId: z.ZodOptional<z.ZodString>;
        stateCode: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    discountType: z.ZodOptional<z.ZodEnum<{
        percent: "percent";
        amount: "amount";
    }>>;
    discountValue: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    taxRate: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    shippingCharges: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    items: z.ZodOptional<z.ZodArray<z.ZodObject<{
        product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        productName: z.ZodOptional<z.ZodString>;
        sku: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        hsnCode: z.ZodOptional<z.ZodString>;
        quantity: z.ZodCoercedNumber<unknown>;
        unit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        unitPrice: z.ZodCoercedNumber<unknown>;
        discountPercent: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
        taxRate: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    }, z.core.$strip>>>;
    status: z.ZodOptional<z.ZodEnum<{
        draft: "draft";
        sent: "sent";
    }>>;
    notes: z.ZodOptional<z.ZodString>;
    termsAndConditions: z.ZodOptional<z.ZodString>;
    shippingMarks: z.ZodOptional<z.ZodString>;
    invoiceDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    dueDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export declare const recordPaymentSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    paymentMethod: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        "Wire Transfer": "Wire Transfer";
        "Letter of Credit (LC)": "Letter of Credit (LC)";
        "Credit Card": "Credit Card";
        "Bank Transfer": "Bank Transfer";
        Cash: "Cash";
        Other: "Other";
    }>>>;
    paymentDate: z.ZodOptional<z.ZodString>;
    referenceNumber: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    notes: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export declare const voidInvoiceSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export declare const templateItemSchema: z.ZodObject<{
    product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    productName: z.ZodString;
    sku: z.ZodString;
    size: z.ZodDefault<z.ZodString>;
    finish: z.ZodDefault<z.ZodString>;
    color: z.ZodDefault<z.ZodString>;
    brand: z.ZodDefault<z.ZodString>;
    quantity: z.ZodCoercedNumber<unknown>;
    unitPrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    packaging: z.ZodDefault<z.ZodString>;
    customMarking: z.ZodDefault<z.ZodString>;
    itemNotes: z.ZodDefault<z.ZodString>;
    totalPrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    snapshot: z.ZodOptional<z.ZodObject<{
        basePrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        weightKg: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        pcsPerCarton: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        tierDiscountPercent: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        finishSurcharge: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        laserMarkingCost: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        packagingCost: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TemplateItemInput = z.infer<typeof templateItemSchema>;
export declare const createTemplateSchema: z.ZodObject<{
    name: z.ZodString;
    items: z.ZodOptional<z.ZodArray<z.ZodObject<{
        product: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        productName: z.ZodString;
        sku: z.ZodString;
        size: z.ZodDefault<z.ZodString>;
        finish: z.ZodDefault<z.ZodString>;
        color: z.ZodDefault<z.ZodString>;
        brand: z.ZodDefault<z.ZodString>;
        quantity: z.ZodCoercedNumber<unknown>;
        unitPrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        packaging: z.ZodDefault<z.ZodString>;
        customMarking: z.ZodDefault<z.ZodString>;
        itemNotes: z.ZodDefault<z.ZodString>;
        totalPrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        snapshot: z.ZodOptional<z.ZodObject<{
            basePrice: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            weightKg: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            pcsPerCarton: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            tierDiscountPercent: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            finishSurcharge: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            laserMarkingCost: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            packagingCost: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    fromOrderId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export declare const createAddressSchema: z.ZodObject<{
    label: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        "bill-to": "bill-to";
        "ship-to": "ship-to";
    }>>>;
    line1: z.ZodString;
    line2: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    city: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    state: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    country: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    postalCode: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export declare const updateAddressSchema: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<{
        "bill-to": "bill-to";
        "ship-to": "ship-to";
    }>>;
    line1: z.ZodOptional<z.ZodString>;
    line2: z.ZodOptional<z.ZodString>;
    city: z.ZodOptional<z.ZodString>;
    state: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    postalCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
