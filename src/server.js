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
import { seedDatabase } from './seed/seedData.js';
import { logger } from './utils/logger.js';

import authRoutes from './routes/authRoutes.js';
import attributeRoutes from './routes/attributeRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import userRoutes from './routes/userRoutes.js';
import { sanitizeMongoInput } from './middleware/mongoSanitize.js';

dotenv.config();

// Secrets & Env Hygiene: refuse booting with placeholder secrets in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error('FATAL: JWT_SECRET must be configured with at least 16 characters in production!');
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

const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.trim().replace(/\/$/, '') : 'http://localhost:5173';

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

      // Check strictly against configured CLIENT_URL
      if (origin === clientUrl) {
        return callback(null, true);
      }

      return callback(new Error(`CORS policy violation: origin '${origin}' is not authorized.`));
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/users', userRoutes);


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

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled Global Error', {
    requestId: req.id,
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    requestId: req.id,
  });
});

// Start Server and Initialize DB
const startServer = async () => {
  try {
    await connectDB();
    await seedDatabase();

    const HOST = '0.0.0.0';
    app.listen(PORT, HOST, () => {
      logger.info(`H.A. Overseas API running on http://${HOST}:${PORT}`, { port: PORT });
    });
  } catch (err) {
    logger.error('Fatal Error on Server Start', { error: err.message });
  }
};

startServer();
