/**
 * Notification — hand-written type-only mirror of
 * src/models/Notification.js (FEAT-01, v0.4). The model stores `type` as
 * a free-form string (no enum), so it stays `string` here.
 */
import type { ObjectIdString, Timestamps } from './envelope.js';

export interface Notification extends Timestamps {
  _id: ObjectIdString;
  id?: ObjectIdString;
  /** Ref to the recipient User. */
  user: ObjectIdString;
  /** Free-form notification kind (no enum in the model). */
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
}
