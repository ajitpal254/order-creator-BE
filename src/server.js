import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/db.js';
import { validateEnv } from './config/validateEnv.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import { seedDatabase } from './seed/seedData.js';
import { logger } from './utils/logger.js';

import authRoutes from './routes/authRoutes.js';
import attributeRoutes from './routes/attributeRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import fxRoutes from './routes/fxRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import addressRoutes from './routes/addressRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import { stripeWebhook } from './controllers/paymentController.js';
import trackingRoutes from './routes/trackingRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import gstRoutes from './routes/gstRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import { OUTBOX_INTERVAL_MS } from './services/outbox.js';
import { registerBuiltinJobs } from './services/jobs.js';
import { startQueue, scheduleRecurring } from './services/queue.js';
import publicApiRoutes from './routes/publicApiRoutes.js';
import developerRoutes from './routes/developerRoutes.js';
import { sanitizeMongoInput } from './middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from './middleware/bodyParsers.js';
import { readyHandler, docsHandler } from './utils/metaHandlers.js';
import { initSentry } from './utils/sentry.js';

dotenv.config();

// QOL-06: Sentry is env-gated — a no-op unless SENTRY_DSN is set.
await initSentry();

// Boot-time env validation (QOL-03): in production this fails fast,
// listing EVERY missing required variable in one error. Optional
// variables only ever warn, and non-production never throws.
try {
  validateEnv();
} catch (err) {
  logger.error(`FATAL: ${err.message}`);
  process.exit(1);
}

// Secrets & Env Hygiene: refuse booting with placeholder secrets in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    logger.error('FATAL: JWT_SECRET must be configured with at least 16 characters in production!');
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Log the allowlist at boot: a wrong CLIENT_URL is the usual cause of a
// deployed CORS error, and the browser never shows the server-side reason.
logger.info(`CORS allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
if (process.env.NODE_ENV === 'production' && allowedOrigins.some((o) => o.includes('localhost'))) {
  logger.warn(
    'CLIENT_URL contains a localhost origin in production — the deployed frontend will be rejected by CORS. Set CLIENT_URL (Render dashboard) to the exact deployed frontend origin.'
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, server-to-server, mobile)
      if (!origin) return callback(null, true);

      // In local dev, allow localhost and 127.0.0.1 on any port
      if (process.env.NODE_ENV !== 'production') {
        if (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
          return callback(null, true);
        }
      }

      // Check strictly against configured CLIENT_URL list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // SEC-05: a rejected origin is a 403, not a 500 — tag the error so
      // the global error handler can map it (it also matches the message).
      const corsError = new Error(`CORS policy violation: origin '${origin}' is not authorized.`);
      corsError.status = 403;
      return callback(corsError);
    },
    credentials: true,
  })
);

app.use(cookieParser());
// FEAT-03 (v0.6): Stripe webhook needs the RAW body for signature
// verification — wired with express.raw BEFORE the global JSON parser,
// scoped to this single route so the 100kb JSON limit stays intact elsewhere.
app.post('/api/payments/webhook/stripe', express.raw({ type: 'application/json', limit: '100kb' }), stripeWebhook);
// FEAT-16 Stage 4b (v1.0): WhatsApp webhook — mounted BEFORE the global
// JSON parser (its router captures the raw body for signature
// verification) and OUTSIDE the JWT-protected assistant router.
app.use('/api/assistant/whatsapp', whatsappRoutes);
// SEC-13: 100kb default body limit (was 10mb). Multipart uploads are
// handled by multer with its own limits, not by these parsers — see
// src/middleware/bodyParsers.js.
app.use(jsonBodyParser);
app.use(urlencodedBodyParser);

// Sanitize MongoDB operators against NoSQL injection
app.use(sanitizeMongoInput);


// Request Correlation ID & Logging Middleware
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`, {
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
    });
  });
  next();
});

// Static uploads folder
const uploadPath = path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadPath));

// Rate Limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
});

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/attributes', attributeRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/invoices', gstRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/public/v1', publicApiRoutes);
app.use('/api/developer', developerRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/fx', fxRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/track', trackingRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/companies', companyRoutes);


// Root Endpoint & Health Checks
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'H.A. Overseas Order Creator API',
    status: 'Operational',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'H.A. Overseas Order Creator API',
    status: 'Operational',
    timestamp: new Date().toISOString(),
  });
});

// QOL-06: readiness probe — 200 only when the DB connection pings.
app.get('/api/ready', readyHandler);

// QOL-05: OpenAPI spec (JSON) — non-production only; 404s in production.
app.get('/api/docs', docsHandler);


// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler (SEC-05: generic 5xx in production, CORS → 403)
app.use(globalErrorHandler);

// Start Server and Initialize DB
const startServer = async () => {
  try {
    await connectDB();
    // v1.0 (B2): the transactional email outbox now runs through the
    // job queue platform layer. startOutboxWorker() only ever set an
    // interval (no immediate first pass), so boot matches that: the
    // recurring 'email.outbox.process' job fires first after
    // OUTBOX_INTERVAL_MS, and the queue is the ONLY mechanism running
    // it — startOutboxWorker() is no longer called here.
    registerBuiltinJobs();
    await startQueue();
    scheduleRecurring('email.outbox.process', OUTBOX_INTERVAL_MS);
    await seedDatabase();

    const HOST = '0.0.0.0';
    app.listen(PORT, HOST, () => {
      logger.info(`H.A. Overseas API running on http://${HOST}:${PORT}`, { port: PORT });
    });
  } catch (err) {
    // SEC-11: a failed start must actually fail — exit non-zero so the
    // host (Render) reports the deploy as failed instead of leaving a
    // dead process that looks alive.
    logger.error('Fatal Error on Server Start', { error: err.message });
    process.exit(1);
  }
};

startServer();
