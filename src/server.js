import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/db.js';
import { seedDatabase } from './seed/seedData.js';

import authRoutes from './routes/authRoutes.js';
import attributeRoutes from './routes/attributeRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import userRoutes from './routes/userRoutes.js';

dotenv.config();

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

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow localhost dev servers or mobile/postman tools
      if (!origin || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Dev-permissive
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/users', userRoutes);

// Root Endpoint & Health Checks
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'H.A. Overseas Order Creator API',
    status: 'Operational',
    frontendUrl: 'http://localhost:5173',
    message: 'Backend server is running! Access the web application UI at http://localhost:5173',
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
  console.error('[Global Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start Server and Initialize DB
const startServer = async () => {
  try {
    await connectDB();
    await seedDatabase();

    const HOST = '0.0.0.0';
    app.listen(PORT, HOST, () => {
      console.log(`[Server] H.A. Overseas API running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('[Fatal Error on Server Start]', err);
  }
};

startServer();
