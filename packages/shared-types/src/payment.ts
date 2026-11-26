/**
 * Payment — hand-written type-only mirror of src/models/Payment.js
 * (FEAT-03, v0.6, env-gated payments). No Zod schema exists for the
 * stored Payment entity (recordPaymentSchema in validate.js targets the
 * invoice payment-history flow instead — see ./schemas.ts).
 */
import type { IsoDateString, ObjectIdString, Timestamps } from './envelope.js';

/** Method enum from src/models/Payment.js. */
export type PaymentMethod = 'card' | 'bank_transfer';

/** Status enum from src/models/Payment.js. */
export type PaymentStatus =
  | 'initiated'
  | 'pending_proof'
  | 'proof_submitted'
  | 'confirmed'
  | 'failed'
  | 'refunded';

export interface Payment extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  /** Ref to Order. */
  order: ObjectIdString;
  /** Ref to Invoice, or null. */
  invoice: ObjectIdString | null;
  /** Ref to the buying User. */
  buyer: ObjectIdString;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  providerRef: string | null;
  proofFile: string | null;
  proofOriginalName: string | null;
  rejectReason: string | null;
  createdBy: ObjectIdString | null;
  confirmedBy: ObjectIdString | null;
  confirmedAt: IsoDateString | null;
}
