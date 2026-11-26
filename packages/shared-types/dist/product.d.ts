/**
 * Product — hand-written type-only mirror of src/models/Product.js.
 *
 * Hand-written because product create/update are hand-validated in the
 * controller (no Zod schema exists for products — see the note in
 * src/utils/openapi.js, which mirrors the same fields as JSON Schema).
 *
 * Includes the FEAT-09 (v0.7) inventory / lead-time fields: leadTimeDays,
 * stockQuantity, availabilityNote and priceBreaks (data only — price
 * breaks are never wired into order pricing).
 */
import type { ObjectIdString, Timestamps } from './envelope.js';
/** One quantity price break (data only). */
export interface ProductPriceBreak {
    minQty?: number;
    unitPrice?: number;
}
/** One key/value specification entry. */
export interface ProductSpecification {
    key?: string;
    value?: string;
}
export interface Product extends Timestamps {
    _id: ObjectIdString;
    id?: ObjectIdString;
    name: string;
    sku: string;
    category: string;
    description: string;
    images: string[];
    basePrice: number;
    currency: string;
    /** Minimum order quantity. */
    moq: number;
    /** FEAT-09: lead time in days, or null when unset. */
    leadTimeDays: number | null;
    /** FEAT-09: stock on hand, or null when unset. */
    stockQuantity: number | null;
    /** FEAT-09: free-text availability note. */
    availabilityNote: string;
    /** FEAT-09: quantity price breaks (data only). */
    priceBreaks: ProductPriceBreak[];
    weightKg: number;
    pcsPerCarton: number;
    allowedSizes: string[];
    allowedFinishes: string[];
    allowedColors: string[];
    allowedBrands: string[];
    specifications: ProductSpecification[];
    isActive: boolean;
}
