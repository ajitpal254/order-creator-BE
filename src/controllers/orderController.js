import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { Invoice } from '../models/Invoice.js';
import { generateOrderPdf } from '../utils/pdfGenerator.js';
import { validateStateTransition, ORDER_STATES } from '../utils/stateMachine.js';
import { logger } from '../utils/logger.js';
import {
  getTierDiscountPercent,
  CURRENCY_RATES,
  getCarrierTrackingUrl,
} from '../utils/pricing.js';
import {
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
  sendStatusUpdateEmail,
} from '../utils/emailService.js';
import { calculateInvoiceTotals } from '../utils/taxCalculator.js';


// Helper to generate sequential-style Order Number
const generateOrderNumber = (orderType = 'Order') => {
  const prefix = orderType === 'Quote' ? 'RFQ' : 'HAO';
  const year = new Date().getFullYear();
  const randomPart = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${year}-${randomPart}`;
};

// @desc Create or Draft a customized order / quotation
// @route POST /api/orders
export const createOrder = async (req, res) => {
  try {
    const {
      items,
      shippingMarks,
      specialInstructions,
      customerDetailsOverride,
      status = ORDER_STATES.SUBMITTED,
      orderType = 'Order',
      incoterm = 'FOB',
      currency = 'USD',
    } = req.body;

    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;

    // Check for existing order with same idempotency key
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ idempotencyKey, user: req.user._id });
      if (existingOrder) {
        logger.info(`Idempotent replay for order #${existingOrder.orderNumber}`, { idempotencyKey });
        return res.status(200).json({
          success: true,
          message: `Order #${existingOrder.orderNumber} already processed.`,
          order: existingOrder,
          isReplay: true,
        });
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your order must contain at least one item.',
      });
    }

    const userTier = req.user.distributorTier || 'Standard';
    const tierDiscountPercent = getTierDiscountPercent(userTier);
    const currencyMultiplier = CURRENCY_RATES[currency] || 1.0;

    let totalQuantity = 0;
    let subtotalAmount = 0;
    let estimatedWeightKg = 0;
    let estimatedCartons = 0;

    const validatedItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity, 10);
      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for item ${item.productName || item.sku}`,
        });
      }

      // Base pricing & weights
      let basePriceUsd = Number(item.unitPrice) || 0;
      let weightKg = 1.0;
      let pcsPerCarton = 20;

      if (item.product) {
        const prod = await Product.findById(item.product);
        if (prod) {
          basePriceUsd = prod.basePrice ?? basePriceUsd;
          weightKg = prod.weightKg || 1.0;
          pcsPerCarton = prod.pcsPerCarton || 20;
        }
      }

      // Apply distributor discount
      const discountedUnitUsd = basePriceUsd * (1 - tierDiscountPercent);
      const convertedUnitPrice = parseFloat((discountedUnitUsd * currencyMultiplier).toFixed(2));
      const itemTotal = parseFloat((convertedUnitPrice * quantity).toFixed(2));

      totalQuantity += quantity;
      subtotalAmount += (basePriceUsd * currencyMultiplier) * quantity;
      estimatedWeightKg += weightKg * quantity;
      estimatedCartons += Math.ceil(quantity / pcsPerCarton);

      validatedItems.push({
        product: item.product || null,
        productName: item.productName || 'Hand Tool',
        sku: item.sku || 'N/A',
        size: item.size || 'Standard',
        finish: item.finish || 'Standard',
        color: item.color || 'Standard',
        brand: item.brand || 'H.A. Overseas',
        quantity,
        unitPrice: convertedUnitPrice,
        totalPrice: itemTotal,
        packaging: item.packaging || 'Master Carton',
        customMarking: item.customMarking || '',
        itemNotes: item.itemNotes || '',
        snapshot: {
          basePrice: basePriceUsd,
          weightKg,
          pcsPerCarton,
          tierDiscountPercent: tierDiscountPercent * 100,
          finishSurcharge: 0,
          laserMarkingCost: 0,
          packagingCost: 0,
        },
      });
    }

    const totalAmount = validatedItems.reduce((sum, it) => sum + it.totalPrice, 0);
    const discountAmount = parseFloat(Math.max(0, subtotalAmount - totalAmount).toFixed(2));

    const orderNumber = generateOrderNumber(orderType);

    const customerDetails = {
      customerName: customerDetailsOverride?.customerName || req.user.customerName,
      businessName: customerDetailsOverride?.businessName || req.user.businessName,
      country: customerDetailsOverride?.country || req.user.country,
      phoneNumber: customerDetailsOverride?.phoneNumber || req.user.phoneNumber,
      address: customerDetailsOverride?.address || req.user.address,
      email: req.user.email,
    };

    const initialStatus = status === ORDER_STATES.DRAFT ? ORDER_STATES.DRAFT : ORDER_STATES.SUBMITTED;

    const order = new Order({
      orderNumber,
      orderType,
      user: req.user._id,
      customerDetails,
      items: validatedItems,
      totalQuantity,
      subtotalAmount: parseFloat(subtotalAmount.toFixed(2)),
      discountPercent: tierDiscountPercent * 100,
      discountAmount,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      distributorTierSnapshot: userTier,
      currency,
      currencyRate: currencyMultiplier,
      incoterm,
      estimatedWeightKg: parseFloat(estimatedWeightKg.toFixed(2)),
      estimatedCartons,
      shippingMarks: shippingMarks || '',
      specialInstructions: specialInstructions || '',
      status: initialStatus,
      idempotencyKey: idempotencyKey || null,
      timeline: [
        {
          status: initialStatus,
          updatedBy: req.user.customerName || req.user.username,
          updatedAt: new Date(),
          note:
            initialStatus === ORDER_STATES.DRAFT
              ? 'Draft saved'
              : orderType === 'Quote'
              ? 'Quotation RFQ submitted by buyer'
              : 'Order submitted online by buyer',
        },
      ],
    });

    await order.save();

    logger.info(`New ${orderType} created: ${orderNumber} [${initialStatus}]`, {
      orderId: order._id,
      userId: req.user._id,
      totalAmount,
    });

    // Trigger transactional emails asynchronously
    if (initialStatus === ORDER_STATES.SUBMITTED) {
      sendOrderConfirmationEmail({ order, user: req.user }).catch((err) =>
        logger.error('Failed to send confirmation email', { error: err.message })
      );
      sendAdminOrderNotificationEmail({ order }).catch((err) =>
        logger.error('Failed to send admin order notification', { error: err.message })
      );
    }

    return res.status(201).json({
      success: true,
      message:
        initialStatus === ORDER_STATES.DRAFT
          ? `Draft order #${orderNumber} saved successfully.`
          : orderType === 'Quote'
          ? `Quotation request #${orderNumber} submitted! Our export desk will issue a formal quote.`
          : `Order #${orderNumber} submitted successfully! Our export desk will review your specifications.`,
      order,
    });
  } catch (error) {
    logger.error('Error creating order', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Convert Quote to Confirmed Order
// @route POST /api/orders/:id/convert-quote
export const convertQuoteToOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }

    if (order.orderType !== 'Quote') {
      return res.status(400).json({ success: false, message: 'This document is already an Order.' });
    }

    order.orderType = 'Order';
    order.status = ORDER_STATES.CONFIRMED;
    order.timeline.push({
      status: ORDER_STATES.CONFIRMED,
      updatedBy: req.user.customerName || req.user.username,
      updatedAt: new Date(),
      note: 'Quotation converted to binding Confirmed Order by Export Admin',
    });

    await order.save();

    sendStatusUpdateEmail({
      order,
      user: order.user,
      newStatus: ORDER_STATES.CONFIRMED,
      note: 'Your quotation has been approved and converted to a Confirmed Order.',
    }).catch((err) => logger.error('Quote conversion email failed', { error: err.message }));

    return res.status(200).json({
      success: true,
      message: `Quotation #${order.orderNumber} successfully converted to Confirmed Order!`,
      order,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get logged-in user orders
// @route GET /api/orders/my-orders
export const getMyOrders = async (req, res) => {
  try {
    const { includeDrafts, orderType } = req.query;
    const filter = { user: req.user._id };

    if (!includeDrafts || includeDrafts === 'false') {
      filter.status = { $ne: ORDER_STATES.DRAFT };
    }

    if (orderType && orderType !== 'All') {
      filter.orderType = orderType;
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get Buyer Analytics Summary
// @route GET /api/orders/buyer-analytics
export const getBuyerAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;

    const orders = await Order.find({
      user: userId,
      status: { $ne: ORDER_STATES.DRAFT },
    });

    const totalOrders = orders.length;
    const activeProduction = orders.filter((o) =>
      ['Confirmed', 'In Production', 'Quality Check'].includes(o.status)
    ).length;
    const totalSpend = orders
      .filter((o) => o.status !== ORDER_STATES.CANCELLED)
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalUnits = orders
      .filter((o) => o.status !== ORDER_STATES.CANCELLED)
      .reduce((sum, o) => sum + (o.totalQuantity || 0), 0);

    return res.status(200).json({
      success: true,
      analytics: {
        totalOrders,
        activeProduction,
        totalSpendUsd: parseFloat(totalSpend.toFixed(2)),
        totalUnitsExported: totalUnits,
        distributorTier: req.user.distributorTier || 'Standard',
        tierDiscountPercent: getTierDiscountPercent(req.user.distributorTier) * 100,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get user active draft order if any
// @route GET /api/orders/draft
export const getActiveDraft = async (req, res) => {
  try {
    const draft = await Order.findOne({
      user: req.user._id,
      status: ORDER_STATES.DRAFT,
    }).sort({ updatedAt: -1 });

    return res.status(200).json({
      success: true,
      draft: draft || null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get single order by ID
// @route GET /api/orders/:id
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'username email customerName businessName distributorTier');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const orderUserId = order.user?._id ? order.user._id.toString() : order.user?.toString();
    const reqUserId = req.user?._id?.toString();
    const isStaff = ['admin', 'sales_manager', 'production_supervisor', 'qc_inspector', 'shipping_officer', 'super_admin'].includes(req.user.role);

    if (orderUserId !== reqUserId && !isStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this order' });
    }

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get all orders (Admin & Staff)
// @route GET /api/orders
export const getAllOrders = async (req, res) => {
  try {
    const { status, search, incoterm, orderType } = req.query;
    const filter = {};

    if (status && status !== 'All') {
      filter.status = status;
    } else {
      filter.status = { $ne: ORDER_STATES.DRAFT };
    }

    if (orderType && orderType !== 'All') {
      filter.orderType = orderType;
    }

    if (incoterm && incoterm !== 'All') {
      filter.incoterm = incoterm;
    }

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { orderNumber: searchRegex },
        { 'customerDetails.customerName': searchRegex },
        { 'customerDetails.businessName': searchRegex },
        { 'customerDetails.country': searchRegex },
        { trackingNumber: searchRegex },
      ];
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'username email customerName businessName distributorTier');

    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update Order Status with State Machine Guard
// @route PATCH /api/orders/:id/status
export const updateOrderStatus = async (req, res) => {
  try {
    const { status, note, adminNotes, cancellationReason, trackingNumber, carrierName } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (status) {
      const validation = validateStateTransition(
        order.status,
        status,
        req.user.role,
        cancellationReason
      );

      if (!validation.valid) {
        logger.warn(`Illegal order transition attempt for #${order.orderNumber}`, {
          from: order.status,
          to: status,
          role: req.user.role,
          error: validation.error,
        });
        return res.status(400).json({
          success: false,
          message: validation.error,
        });
      }

      order.status = status;

      if (status === ORDER_STATES.CANCELLED) {
        order.cancellationReason = cancellationReason;
      }

      if (trackingNumber) {
        order.trackingNumber = trackingNumber;
        order.carrierName = carrierName || 'Freight Carrier';
        order.trackingUrl = getCarrierTrackingUrl(order.carrierName, trackingNumber);
      }

      order.timeline.push({
        status,
        updatedBy: req.user.customerName || req.user.username,
        updatedAt: new Date(),
        note: note || (status === ORDER_STATES.CANCELLED ? `Order cancelled: ${cancellationReason}` : `Status updated to ${status}`),
      });
    }

    if (adminNotes !== undefined) {
      order.adminNotes = adminNotes;
    }

    await order.save();

    logger.info(`Order #${order.orderNumber} status transitioned to [${order.status}]`, {
      orderId: order._id,
      updatedBy: req.user.username,
    });

// Helper to automatically generate or link native Invoice record
const ensureOrderInvoice = async (order) => {
  let existingInvoice = await Invoice.findOne({ order: order._id });
  if (existingInvoice) {
    return {
      invoiceId: existingInvoice.invoiceNumber,
      pdfUrl: `/api/invoices/${existingInvoice._id}/pdf`,
      status: existingInvoice.status,
      isPending: false,
      lastAttemptAt: new Date(),
      error: null,
    };
  }

  const itemsToProcess = (order.items || []).map((it) => ({
    product: it.product || null,
    productName: it.productName,
    sku: it.sku,
    description: `${it.productName} (${it.sku}) - ${it.size}, ${it.finish}, ${it.color}`,
    hsnCode: '8205.59',
    quantity: it.quantity,
    unit: 'PCS',
    unitPrice: it.unitPrice,
    discountPercent: it.snapshot?.tierDiscountPercent || 0,
    taxRate: 0,
  }));

  const calculation = calculateInvoiceTotals({
    items: itemsToProcess,
    docType: 'commercial_invoice',
    currency: order.currency || 'USD',
    discountType: 'amount',
    discountValue: order.discountAmount || 0,
    taxRate: 0,
    senderStateCode: '03',
    recipientStateCode: '',
  });

  const invoiceNumber = `INV-${order.orderNumber}`;
  const invoice = new Invoice({
    invoiceNumber,
    docType: 'commercial_invoice',
    status: 'sent',
    order: order._id,
    user: order.user,
    customerDetails: {
      customerName: order.customerDetails?.customerName || 'Export Buyer',
      businessName: order.customerDetails?.businessName || '',
      country: order.customerDetails?.country || '',
      phoneNumber: order.customerDetails?.phoneNumber || '',
      address: order.customerDetails?.address || '',
      email: order.customerDetails?.email || '',
      taxId: '',
      stateCode: '',
    },
    items: calculation.items,
    currency: order.currency || 'USD',
    incoterm: order.incoterm || 'FOB',
    totalQuantity: calculation.totalQty,
    subtotal: calculation.subtotal,
    discountType: 'amount',
    discountValue: order.discountAmount || 0,
    discountAmount: calculation.discountAmount,
    taxableAmount: calculation.taxableAmount,
    taxRate: 0,
    taxAmount: 0,
    grandTotal: calculation.grandTotal,
    amountPaid: 0,
    balanceDue: calculation.grandTotal,
    totalInWords: calculation.totalInWords,
    shippingMarks: order.shippingMarks || '',
  });

  await invoice.save();

  return {
    invoiceId: invoice.invoiceNumber,
    pdfUrl: `/api/invoices/${invoice._id}/pdf`,
    status: invoice.status,
    isPending: false,
    lastAttemptAt: new Date(),
    error: null,
  };
};

    // Trigger native Invoice generation on Confirmed status
    if (status === ORDER_STATES.CONFIRMED) {
      ensureOrderInvoice(order)
        .then(async (invResult) => {
          order.invoice = invResult;
          await order.save();
          logger.info(`Native invoice generated for #${order.orderNumber}: ${invResult.invoiceId}`);
        })
        .catch((err) => {
          logger.warn(`Failed to auto-generate native invoice for #${order.orderNumber}`, { error: err.message });
        });
    }

    if (status) {
      sendStatusUpdateEmail({
        order,
        user: order.user,
        newStatus: order.status,
        note,
      }).catch((err) =>
        logger.error('Failed to send status update email', { error: err.message })
      );
    }

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${order.status}`,
      data: order,
    });
  } catch (error) {
    logger.error('Error updating order status', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Retry pending invoice synchronization (Admin & Background job)
// @route POST /api/orders/:id/retry-invoice
export const retryInvoiceSync = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const invResult = await ensureOrderInvoice(order);
    order.invoice = invResult;
    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Native commercial invoice generated and synchronized successfully!',
      invoice: order.invoice,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Download Order PDF Proforma / Purchase Order Sheet
// @route GET /api/orders/:id/pdf
export const downloadOrderPdf = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const orderUserId = order.user?._id ? order.user._id.toString() : order.user?.toString();
    const reqUserId = req.user?._id?.toString();
    const isStaff = ['admin', 'sales_manager', 'production_supervisor', 'qc_inspector', 'shipping_officer', 'super_admin'].includes(req.user.role);

    if (orderUserId !== reqUserId && !isStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized to download this order PDF' });
    }

    const pdfBuffer = await generateOrderPdf(order);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="HAO_Order_${order.orderNumber}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    logger.error('PDF Generation Error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Error generating PDF proforma: ' + error.message });
  }
};

// @desc Get Revenue and Order Statistics (Admin & Staff)
// @route GET /api/orders/stats/overview
export const getOrderStats = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments({ status: { $ne: ORDER_STATES.DRAFT }, orderType: 'Order' });
    const totalQuotes = await Order.countDocuments({ orderType: 'Quote' });
    const submittedOrders = await Order.countDocuments({ status: ORDER_STATES.SUBMITTED });
    const inProductionOrders = await Order.countDocuments({ status: ORDER_STATES.IN_PRODUCTION });
    const shippedOrders = await Order.countDocuments({ status: ORDER_STATES.SHIPPED });
    const closedOrders = await Order.countDocuments({ status: ORDER_STATES.CLOSED });

    const totalRevenueAgg = await Order.aggregate([
      { $match: { status: { $nin: [ORDER_STATES.DRAFT, ORDER_STATES.CANCELLED] }, orderType: 'Order' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, totalUnits: { $sum: '$totalQuantity' } } },
    ]);

    const revenue = totalRevenueAgg[0]?.total || 0;
    const units = totalRevenueAgg[0]?.totalUnits || 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalOrders,
        totalQuotes,
        submittedOrders,
        inProductionOrders,
        shippedOrders,
        closedOrders,
        totalRevenueUsd: parseFloat(revenue.toFixed(2)),
        totalUnitsExported: units,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
