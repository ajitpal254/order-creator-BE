# @hao/shared-types

Shared TypeScript types for the H.A. Overseas order-creator platform —
the v1.0 release plan's "shared Zod/TS types package" deliverable.

## What this is (and is not)

- This is a **type-only** package. The backend runtime remains
  JavaScript (Express + Mongoose ESM); nothing in `src/` imports or
  depends on this package at runtime, and no runtime code was migrated
  to TypeScript.
- Entity types (`User`, `Product`, `Order`, `Invoice`, `Payment`,
  `Company`, `Address`, `OrderTemplate`, `Notification`, …) are
  hand-written mirrors of the Mongoose models in `../../src/models/`,
  with enums copied from the models and from
  `../../src/utils/stateMachine.js`. Secret fields (password hashes,
  2FA secrets, reset tokens, API-key secrets, webhook signing secrets)
  are deliberately excluded.
- Request input types (`CreateOrderInput`, `SignupInput`, …) are
  derived with `z.infer` from Zod schemas in `src/schemas.ts`. Those
  schemas are faithful copies of the backend's real validation schemas
  in `../../src/middleware/validate.js` — mirrored, not imported,
  because a standalone type package cannot cleanly import JavaScript
  from the backend's `src/` tree. Keep them in sync when a request
  shape changes in `validate.js`.
- Envelope types (`ApiSuccess<T>`, `ApiPaginated<T>`, `ApiError`) match
  the shapes emitted by the controllers and by `paginatedResponse` in
  `../../src/utils/paginate.js`.
- `ApiKeyPublic`, `WebhookSubscriptionPublic` and `WebhookEvent` define
  the public (metadata-only) contract for the v1.0 developer API.

## Build / typecheck

```sh
# from the repo root — typechecks this package and emits dist/*.d.ts
npm run typecheck

# or inside this package
npm install   # the package has its own node_modules (zod)
npm run build # tsc -p tsconfig.json, declaration-only emit
```

The built `dist/*.d.ts` files are committed to the repo so consumers
can use the package without building it first.

## How the frontend would consume this (future)

The frontend is a separate repo, so consumption is by published copy,
not a workspace link:

1. Publish or vendor this package (e.g. `npm pack` here, or a private
   registry / git dependency) and add it to the frontend:
   `npm install @hao/shared-types`.
2. Import types only — they erase at compile time, so there is zero
   runtime cost and no backend code ships to the browser:

   ```ts
   import type { ApiPaginated, Order, CreateOrderInput } from '@hao/shared-types';

   const res: ApiPaginated<Order> = await api.get('/orders/my-orders');
   const draft: CreateOrderInput = { items: [/* … */] };
   ```

3. The mirrored Zod schemas are also exported (e.g. `createOrderSchema`)
   for consumers that want runtime validation of the same shapes in
   TypeScript code.
