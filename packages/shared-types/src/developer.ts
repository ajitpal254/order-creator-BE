/**
 * Developer-API shapes for v1.0 (API keys + webhooks).
 *
 * These are forward-looking PUBLIC shapes: metadata only. An API key's
 * secret/hash is never part of ApiKeyPublic — only the display prefix
 * used to identify the key. There is no ApiKey/Webhook model in the
 * backend yet; these types define the contract the v1.0 developer API
 * will serialize to.
 */
import type { IsoDateString, ObjectIdString } from './envelope.js';

/** Public, metadata-only view of an API key. Never carries the secret. */
export interface ApiKeyPublic {
  id: ObjectIdString;
  name: string;
  /** Display prefix of the key (e.g. "hao_live_…"), safe to show. */
  prefix: string;
  scopes: string[];
  lastUsedAt: IsoDateString | null;
  createdAt: IsoDateString;
}

/** Webhook event names delivered by the v1.0 developer API. */
export type WebhookEvent =
  | 'order.created'
  | 'order.status_changed'
  | 'order.confirmed'
  | 'payment.confirmed';

/** Public view of a webhook subscription. Never carries the signing secret. */
export interface WebhookSubscriptionPublic {
  id: ObjectIdString;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/** Envelope of a single webhook delivery. */
export interface WebhookPayload<T = unknown> {
  event: WebhookEvent;
  createdAt: IsoDateString;
  data: T;
}
