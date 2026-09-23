import { Order } from '../models/Order.js';
import { logger } from '../utils/logger.js';

/**
 * Service-to-Service Invoicing Handler (Phase A Connect Contract)
 * @route POST /api/internal/invoices
 * @header X-Internal-Key: <shared secret>
 */
export const createInternalInvoice = async (req, res) => {
  try {
    const {
      orderId,
      idempotencyKey,
      buyer,
      lineItems,
      currency = 'USD',
      incoterm = 'FOB',
      totals,
    } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'orderId is required in request payload.',
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order with ID ${orderId} not found.`,
      });
    }

    // Idempotent invoice number generation
    const invoiceNumber = `INV-${order.orderNumber}`;
    const pdfUrl = `/api/orders/${order._id}/pdf`;

    logger.info(`[Internal Invoicing Service] Generated invoice #${invoiceNumber} for Order #${order.orderNumber}`, {
      orderId,
      idempotencyKey,
      grandTotal: totals?.grandTotal || order.totalAmount,
      currency,
    });

    return res.status(200).json({
      success: true,
      invoiceId: invoiceNumber,
      pdfUrl,
      status: 'Generated',
      currency,
      incoterm,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[Internal Invoicing Error]', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal invoice service error: ' + error.message,
    });
  }
};
