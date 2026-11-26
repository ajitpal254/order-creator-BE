/**
 * User — hand-written type-only mirror of src/models/User.js.
 *
 * Hand-written (not Zod-derived) because the stored entity has no Zod
 * schema; the Zod schemas that exist for users are the *request* schemas
 * `signupSchema` / `loginSchema` in src/middleware/validate.js (mirrored
 * in ./schemas.ts, with inferred types SignupInput / LoginInput).
 *
 * Secret fields are deliberately NOT part of this type: the model's
 * password hash, twoFactorSecret, twoFactorBackupCodes and
 * resetPasswordToken/resetPasswordExpires must never be typed as part of
 * an API-facing user shape.
 *
 * Note on naming/refs: the model stores `customerName` (there is no
 * `name` field) and has no direct company ref — company membership lives
 * on CompanyMember (see ./company.ts).
 */
import type { IsoDateString, ObjectIdString, Timestamps } from './envelope.js';

/** Role enum from src/models/User.js. */
export type UserRole =
  | 'user'
  | 'buyer'
  | 'admin'
  | 'sales_manager'
  | 'production_supervisor'
  | 'qc_inspector'
  | 'shipping_officer'
  | 'super_admin';

/** distributorTier enum from src/models/User.js. */
export type DistributorTier = 'Standard' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

/** Notification preferences subdocument (FEAT-01 v0.4, FEAT-11 v0.8). */
export interface UserNotificationPreferences {
  email: boolean;
  /** Opt-in, defaults to false in the model. */
  whatsapp: boolean;
}

export interface User extends Timestamps {
  _id: ObjectIdString;
  /** Convenience alias consumers may map `_id` to. */
  id?: ObjectIdString;
  customerName: string;
  businessName: string;
  country: string;
  phoneNumber: string;
  address: string;
  /** GST/tax registration number; '' by default. */
  taxId: string;
  username: string;
  email: string;
  role: UserRole;
  distributorTier: DistributorTier;
  /** Linked Firebase uid, or null when not linked. */
  firebaseUid: string | null;
  isActive: boolean;
  twoFactorEnabled: boolean;
  /** WhatsApp contact number (FEAT-11); '' until supplied. Distinct from phoneNumber. */
  phone: string;
  notifications: UserNotificationPreferences;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}
