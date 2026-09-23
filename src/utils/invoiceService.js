import { logger } from './logger.js';

/**
 * Service-to-Service Invoice Client (Phase A Connect)
 * Calls external InvoiceApp with shared X-Internal-Key
 * Fails soft so order transitions are never blocked.
 */
export const syncInvoiceWithInvoiceApp = async (order) => {
  const serviceUrl = process.env.INVOICE_SERVICE_URL || 'http://localhost:5000';
  const internalApiKey = process.env.INVOICE_SERVICE_API_KEY || process.env.INTERNAL_API_KEY;

  const payload = {
    orderId: order._id.toString(),
    idempotencyKey: order._id.toString(),
    buyer: {
      name: order.customerDetails?.customerName || '',
      company: order.customerDetails?.businessName || '',
      address: order.customerDetails?.address || '',
      email: order.customerDetails?.email || '',
    },
    lineItems: (order.items || []).map((it) => ({
      description: `${it.productName} (${it.sku}) - ${it.size}, ${it.finish}, ${it.color}`,
      qty: it.quantity,
      unitPrice: it.unitPrice,
    })),
    currency: order.currency || 'USD',
    incoterm: order.incoterm || 'FOB',
    totals: {
      subtotal: order.subtotalAmount || order.totalAmount,
      tax: 0,
      grandTotal: order.totalAmount,
    },
  };

  try {
    const endpoint = `${serviceUrl.replace(/\/$/, '')}/api/internal/invoices`;
    logger.info(`Dispatching invoice sync to InvoiceApp at ${endpoint} for Order #${order.orderNumber}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': internalApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`InvoiceApp HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    return {
      success: true,
      invoiceId: data.invoiceId,
      pdfUrl: data.pdfUrl,
      status: data.status || 'Generated',
      isPending: false,
      lastAttemptAt: new Date(),
      error: null,
    };
  } catch (error) {
    // Fail soft: log error and return pending status
    logger.warn(`[InvoiceApp Sync Soft-Failure] Could not sync invoice for Order #${order.orderNumber}. Will retry later.`, {
      orderId: order._id,
      error: error.message,
    });

    return {
      success: false,
      invoiceId: null,
      pdfUrl: null,
      status: 'PendingSync',
      isPending: true,
      lastAttemptAt: new Date(),
      error: error.message,
    };
  }
};
