/**
 * @hao/shared-types — shared TypeScript types for the H.A. Overseas
 * order-creator platform (v1.0 workstream B4).
 *
 * Type-only package: the backend runtime remains JavaScript. Entity
 * types mirror the Mongoose models; request input types are derived
 * with z.infer from Zod schemas mirrored from src/middleware/validate.js
 * (see ./schemas.ts for why they are mirrored rather than imported).
 */
export * from './envelope.js';
export * from './user.js';
export * from './product.js';
export * from './order.js';
export * from './invoice.js';
export * from './payment.js';
export * from './company.js';
export * from './address.js';
export * from './template.js';
export * from './notification.js';
export * from './developer.js';
export * from './schemas.js';
