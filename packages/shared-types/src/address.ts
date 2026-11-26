/**
 * Address — hand-written type-only mirror of src/models/Address.js
 * (FEAT-05, v0.5 buyer address book). The create/update *request* shapes
 * are Zod-derived in ./schemas.ts (CreateAddressInput / UpdateAddressInput).
 */
import type { ObjectIdString, Timestamps } from './envelope.js';

/** Type enum from src/models/Address.js. */
export type AddressType = 'bill-to' | 'ship-to';

export interface Address extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  /** Ref to the owning User. */
  user: ObjectIdString;
  label: string;
  type: AddressType;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}
