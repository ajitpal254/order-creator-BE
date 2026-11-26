import express from 'express';
import {
  getWhatsAppWebhook,
  postWhatsAppWebhook,
} from '../controllers/whatsappController.js';

/**
 * WhatsApp webhook routes (FEAT-16 Stage 4b, v1.0) — mounted at
 * /api/assistant/whatsapp in server.js BEFORE the global JSON body
 * parser (and outside the JWT-protected assistant router).
 *
 * Signature verification needs the RAW request body, so the POST
 * route carries its own express.json with a `verify` hook that
 * captures req.rawBody — the same pattern as the Stripe webhook in
 * server.js (express.raw scoped to one route), without disturbing it.
 */
const router = express.Router();

router.get('/webhook', getWhatsAppWebhook);

router.post(
  '/webhook',
  express.json({
    limit: '100kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  postWhatsAppWebhook
);

export default router;
