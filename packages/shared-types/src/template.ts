/**
 * OrderTemplate — hand-written type-only mirror of
 * src/models/OrderTemplate.js (FEAT-05, v0.5). Its item subdocument
 * intentionally duplicates the Order item shape. The create *request*
 * shape is Zod-derived in ./schemas.ts (CreateTemplateInput).
 */
import type { ObjectIdString, Timestamps } from './envelope.js';
import type { OrderItem } from './order.js';

/** Template item — same stored shape as an order item. */
export type OrderTemplateItem = OrderItem;

export interface OrderTemplate extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  /** Ref to the owning User. */
  user: ObjectIdString;
  name: string;
  items: OrderTemplateItem[];
}
