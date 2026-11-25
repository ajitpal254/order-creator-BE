/**
 * OpenAPI 3 spec generation (QOL-05).
 *
 * The spec is hand-assembled here, but request-body schemas are derived
 * from the existing Zod validation schemas in src/middleware/validate.js
 * using Zod v4's built-in `z.toJSONSchema()` — no extra dependency is
 * needed (the common @asteasolutions/zod-to-openapi line targets the
 * Zod v3 ecosystem; this repo is on Zod ^4).
 *
 * Endpoints without a Zod schema (forgot/reset password, product
 * create/update — those controllers validate by hand) get small inline
 * JSON Schemas that mirror the controller code.
 */
import { z } from 'zod';
import {
  signupSchema,
  loginSchema,
  createOrderSchema,
  updateOrderStatusSchema,
} from '../middleware/validate.js';

const fromZod = (schema) => {
  const json = z.toJSONSchema(schema);
  const { $schema, ...rest } = json;
  return rest;
};

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const ok = (description = 'Success') => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true } },
        additionalProperties: true,
      },
    },
  },
});

const errorResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
        },
        required: ['success', 'message'],
      },
    },
  },
});

const paginationParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
  { name: 'search', in: 'query', schema: { type: 'string' } },
];

const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
const bearer = [{ bearerAuth: [] }];

const paginatedEnvelope = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    count: { type: 'integer' },
    total: { type: 'integer' },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    data: { type: 'array', items: {} },
  },
  required: ['success', 'count', 'total', 'page', 'limit', 'data'],
};

const listOk = (description) => ({
  description,
  content: { 'application/json': { schema: paginatedEnvelope } },
});

// Product create/update have no Zod schema (hand-validated controller);
// this mirrors the fields createProduct/updateProduct actually read.
const productBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    sku: { type: 'string' },
    category: { type: 'string' },
    description: { type: 'string' },
    basePrice: { type: 'number' },
    currency: { type: 'string', example: 'USD' },
    moq: { type: 'number' },
    weightKg: { type: 'number' },
    pcsPerCarton: { type: 'number' },
    allowedSizes: { type: 'array', items: { type: 'string' } },
    allowedFinishes: { type: 'array', items: { type: 'string' } },
    allowedColors: { type: 'array', items: { type: 'string' } },
    allowedBrands: { type: 'array', items: { type: 'string' } },
    specifications: { type: 'array', items: { type: 'string' } },
    images: { type: 'array', items: { type: 'string' } },
  },
};

export const buildOpenApiSpec = () => ({
  openapi: '3.0.3',
  info: {
    title: 'H.A. Overseas Order Creator API',
    version: '1.0.0',
    description:
      'B2B order platform API. Generated from the Zod validation schemas in src/middleware/validate.js (see scripts/generate-openapi.js). Served at GET /api/docs outside production only.',
  },
  servers: [{ url: '/api', description: 'API base path' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      refreshCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
        description: 'httpOnly refresh-token cookie (SEC-07: cookie-only, body tokens are rejected)',
      },
    },
    schemas: {
      Signup: fromZod(signupSchema),
      Login: fromZod(loginSchema),
      CreateOrder: fromZod(createOrderSchema),
      UpdateOrderStatus: fromZod(updateOrderStatusSchema),
      Product: productBodySchema,
      PaginatedEnvelope: paginatedEnvelope,
    },
  },
  paths: {
    '/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new buyer account',
        requestBody: jsonBody({ $ref: '#/components/schemas/Signup' }),
        responses: { 201: ok('Account created'), 400: errorResponse('Validation failed') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with username/email + password',
        requestBody: jsonBody({ $ref: '#/components/schemas/Login' }),
        responses: { 200: ok('Logged in'), 400: errorResponse('Validation failed'), 401: errorResponse('Invalid credentials') },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token (httpOnly cookie only) and mint a new access token',
        security: [{ refreshCookie: [] }],
        responses: { 200: ok('Token refreshed'), 401: errorResponse('Refresh token missing/invalid') },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Log out and revoke the current refresh session',
        security: bearer,
        responses: { 200: ok('Logged out'), 401: errorResponse('Not authenticated') },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a password-reset email (always answers generically)',
        requestBody: jsonBody({
          type: 'object',
          properties: { email: { type: 'string', format: 'email' } },
          required: ['email'],
        }),
        responses: { 200: ok('Reset instructions dispatched if the account exists') },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset the password with a reset token (revokes all sessions)',
        requestBody: jsonBody({
          type: 'object',
          properties: {
            token: { type: 'string' },
            newPassword: { type: 'string', minLength: 10 },
          },
          required: ['token', 'newPassword'],
        }),
        responses: { 200: ok('Password reset'), 400: errorResponse('Invalid/expired token or weak password') },
      },
    },
    '/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Create an order or quotation',
        security: bearer,
        requestBody: jsonBody({ $ref: '#/components/schemas/CreateOrder' }),
        responses: { 201: ok('Order created'), 400: errorResponse('Validation failed'), 401: errorResponse('Not authenticated') },
      },
      get: {
        tags: ['Orders'],
        summary: 'List all orders (staff only)',
        security: bearer,
        parameters: [
          ...paginationParams,
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'orderType', in: 'query', schema: { type: 'string', enum: ['Order', 'Quote'] } },
          { name: 'incoterm', in: 'query', schema: { type: 'string', enum: ['FOB', 'CIF', 'EXW'] } },
        ],
        responses: { 200: listOk('Paginated orders'), 403: errorResponse('Staff only') },
      },
    },
    '/orders/my-orders': {
      get: {
        tags: ['Orders'],
        summary: "List the logged-in buyer's orders",
        security: bearer,
        parameters: [
          ...paginationParams.filter((p) => p.name !== 'search'),
          { name: 'includeDrafts', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'orderType', in: 'query', schema: { type: 'string', enum: ['Order', 'Quote'] } },
        ],
        responses: { 200: listOk('Paginated orders'), 401: errorResponse('Not authenticated') },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get one order (owner or staff)',
        security: bearer,
        parameters: idParam,
        responses: { 200: ok('Order'), 403: errorResponse('Not authorized'), 404: errorResponse('Order not found') },
      },
    },
    '/orders/{id}/status': {
      patch: {
        tags: ['Orders'],
        summary: 'Transition an order status (state-machine guarded; owner or staff)',
        security: bearer,
        parameters: idParam,
        requestBody: jsonBody({ $ref: '#/components/schemas/UpdateOrderStatus' }),
        responses: { 200: ok('Status updated'), 400: errorResponse('Illegal transition'), 404: errorResponse('Order not found') },
      },
    },
    '/products': {
      get: {
        tags: ['Products'],
        summary: 'List products with filters',
        parameters: [
          ...paginationParams,
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'brand', in: 'query', schema: { type: 'string' } },
          { name: 'finish', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: listOk('Paginated products') },
      },
      post: {
        tags: ['Products'],
        summary: 'Create a product (admin only, multipart or JSON)',
        security: bearer,
        requestBody: jsonBody({ $ref: '#/components/schemas/Product' }),
        responses: { 201: ok('Product created'), 400: errorResponse('Missing/invalid fields'), 403: errorResponse('Admin only') },
      },
    },
    '/products/{id}': {
      get: {
        tags: ['Products'],
        summary: 'Get one product',
        parameters: idParam,
        responses: { 200: ok('Product'), 404: errorResponse('Product not found') },
      },
      put: {
        tags: ['Products'],
        summary: 'Update a product (admin only)',
        security: bearer,
        parameters: idParam,
        requestBody: jsonBody({ $ref: '#/components/schemas/Product' }),
        responses: { 200: ok('Product updated'), 404: errorResponse('Product not found') },
      },
      delete: {
        tags: ['Products'],
        summary: 'Delete a product (admin only)',
        security: bearer,
        parameters: idParam,
        responses: { 200: ok('Product deleted'), 404: errorResponse('Product not found') },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List registered customers (admin only)',
        security: bearer,
        parameters: paginationParams,
        responses: { 200: listOk('Paginated users'), 403: errorResponse('Admin only') },
      },
    },
    '/users/{id}/toggle-status': {
      patch: {
        tags: ['Users'],
        summary: 'Toggle a customer account active/suspended (admin only)',
        security: bearer,
        parameters: idParam,
        responses: { 200: ok('Status toggled'), 404: errorResponse('User not found') },
      },
    },
  },
});

export default buildOpenApiSpec;
