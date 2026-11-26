/**
 * Company + CompanyMember — hand-written type-only mirrors of
 * src/models/Company.js (FEAT-10, v0.9 buyer company accounts).
 * No Zod schemas exist for companies.
 */
import type { ObjectIdString, Timestamps } from './envelope.js';

export interface Company extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  name: string;
  /**
   * Spend limit for approval: null means NO approval is ever required;
   * a numeric value (including 0) is a real limit — orders whose stored
   * totalAmount strictly exceeds it need approval.
   */
  spendLimit: number | null;
  creditTerms: string;
  /** Ref to the creating User. */
  createdBy: ObjectIdString;
}

/** Member role enum — COMPANY_MEMBER_ROLES in src/models/Company.js. */
export type CompanyMemberRole = 'owner' | 'purchaser' | 'approver' | 'finance';

export interface CompanyMember extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  /** Ref to Company. */
  company: ObjectIdString;
  /** Ref to User. */
  user: ObjectIdString;
  role: CompanyMemberRole;
  invitedBy: ObjectIdString | null;
}
