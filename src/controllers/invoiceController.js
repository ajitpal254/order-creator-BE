import { Invoice } from '../models/Invoice.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { calculateInvoiceTotals, roundToTwoDecimals } from '../utils/taxCalculator.js';
import { generateCommercialInvoicePdf } from '../utils/pdfGenerator.js';
import { logger } from '../utils/logger.js';

const STAFF_ROLES = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

const isStaffUser = (user) => user && STAFF_ROLES.includes(user.role);

// Helper to generate sequential-style Invoice Number
const generateInvoiceNumber = (prefix = 'INV', suffix = '') => {
  if (suffix) {
    return `${prefix}-${suffix}`;
  }
  const year = new Date().getFullYear();
  const randomPart = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${year}-${randomPart}`;
};

// @desc Create Invoice (from existing Order or standalone ad-hoc)
// @route POST /api/invoices
export const createInvoice = async (req, res) => {
  try {
    const {
      orderId,
      docType = 'commercial_invoice',
      currency,
      incoterm,
      customerDetails: customCustomer,
      discountType = 'amount',
      discountValue = 0,
      taxRate = 0,
      items: rawItems,
      notes,
      termsAndConditions,
      countryOfDestination,
      portOfDischarge,
      shippingMarks,
      dueDate,
    } = req.body;

    let targetUser = req.user._id;
    let linkedOrder = null;
    let resolvedCustomer = customCustomer || {};
    let resolvedCurrency = currency || 'USD';
    let resolvedIncoterm = incoterm || 'FOB';
    let itemsToProcess = [];

    // Branch 1: Generated from an existing Order
    if (orderId) {
      linkedOrder = await Order.findById(orderId);
      if (!linkedOrder) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      // Authorization check on source order
      const isOwner = linkedOrder.user.toString() === req.user._id.toString();
      const isStaff = isStaffUser(req.user);
      if (!isOwner && !isStaff) {
        return res.status(403).json({ success: false, message: 'Not authorized to generate invoice for this order' });
      }

      targetUser = linkedOrder.user;
      resolvedCurrency = currency || linkedOrder.currency || 'USD';
      resolvedIncoterm = incoterm || linkedOrder.incoterm || 'FOB';

      resolvedCustomer = {
        customerName: customCustomer?.customerName || linkedOrder.customerDetails?.customerName || req.user.customerName,
        businessName: customCustomer?.businessName || linkedOrder.customerDetails?.businessName || req.user.businessName,
        country: customCustomer?.country || linkedOrder.customerDetails?.country || req.user.country,
        phoneNumber: customCustomer?.phoneNumber || linkedOrder.customerDetails?.phoneNumber || req.user.phoneNumber,
        address: customCustomer?.address || linkedOrder.customerDetails?.address || req.user.address,
        email: customCustomer?.email || linkedOrder.customerDetails?.email || req.user.email,
        taxId: customCustomer?.taxId || '',
        stateCode: customCustomer?.stateCode || '',
      };

      // Derive line items from order items with server-verified prices
      itemsToProcess = linkedOrder.items.map((it) => ({
        product: it.product || null,
        productName: it.productName,
        sku: it.sku,
        description: `${it.productName} (${it.sku}) - ${it.size}, ${it.finish}, ${it.color}`,
        hsnCode: '8205.59',
        quantity: it.quantity,
        unit: 'PCS',
        unitPrice: it.unitPrice,
        discountPercent: it.snapshot?.tierDiscountPercent || 0,
        taxRate: taxRate || 0,
      }));
    } else {
      // Branch 2: Standalone Ad-hoc Invoice
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        return res.status(400).json({ success: false, message: 'Standalone invoice requires at least one item' });
      }

      resolvedCustomer = {
        customerName: customCustomer?.customerName || req.user.customerName,
        businessName: customCustomer?.businessName || req.user.businessName,
        country: customCustomer?.country || req.user.country,
        phoneNumber: customCustomer?.phoneNumber || req.user.phoneNumber,
        address: customCustomer?.address || req.user.address,
        email: customCustomer?.email || req.user.email,
        taxId: customCustomer?.taxId || '',
        stateCode: customCustomer?.stateCode || '',
      };

      // Look up products server-side where product ID is provided
      for (const item of rawItems) {
        let price = Number(item.unitPrice) || 0;
        let pName = item.productName || item.description || 'Industrial Hardware';
        let pSku = item.sku || 'N/A';

        if (item.product) {
          const prod = await Product.findById(item.product);
          if (prod) {
            price = prod.basePrice ?? price;
            pName = prod.name;
            pSku = prod.sku;
          }
        }

        itemsToProcess.push({
          product: item.product || null,
          productName: pName,
          sku: pSku,
          description: item.description || pName,
          hsnCode: item.hsnCode || '8205.59',
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'PCS',
          unitPrice: price,
          discountPercent: Number(item.discountPercent) || 0,
          taxRate: Number(item.taxRate) || taxRate || 0,
        });
      }
    }

    // Server-side recalculation of financial totals
    const calculation = calculateInvoiceTotals({
      items: itemsToProcess,
      docType,
      currency: resolvedCurrency,
      discountType,
      discountValue,
      taxRate,
      senderStateCode: process.env.SENDER_STATE_CODE || '03', // Punjab (H.A. Overseas HQ) — override via SENDER_STATE_CODE env var
      recipientStateCode: resolvedCustomer.stateCode || '',
    });

    // Unique invoice number generation with collision-safe retry loop
    let invoiceNumber;
    let collisionAttempts = 0;
    const MAX_ATTEMPTS = 5;
    while (collisionAttempts < MAX_ATTEMPTS) {
      const candidate = linkedOrder
        ? generateInvoiceNumber('INV', linkedOrder.orderNumber)
        : generateInvoiceNumber('INV');
      const exists = await Invoice.findOne({ invoiceNumber: candidate }).lean();
      if (!exists) {
        invoiceNumber = candidate;
        break;
      }
      collisionAttempts++;
    }
    if (!invoiceNumber) {
      throw new Error('Unable to generate a unique invoice number after multiple attempts. Please retry.');
    }

    const invoice = new Invoice({
      invoiceNumber,
      docType,
      status: 'draft', // Invoices start as drafts; staff advances to 'sent' after review
      order: linkedOrder?._id || null,
      user: targetUser,
      customerDetails: resolvedCustomer,
      items: calculation.items,
      currency: resolvedCurrency,
      incoterm: resolvedIncoterm,
      totalQuantity: calculation.totalQty,
      subtotal: calculation.subtotal,
      discountType,
      discountValue,
      discountAmount: calculation.discountAmount,
      taxableAmount: calculation.taxableAmount,
      taxRate,
      taxAmount: calculation.taxAmount,
      isIgst: calculation.isIgst,
      cgstAmount: calculation.cgstAmount,
      sgstAmount: calculation.sgstAmount,
      igstAmount: calculation.igstAmount,
      roundOff: calculation.roundOff,
      grandTotal: calculation.grandTotal,
      amountPaid: 0,
      balanceDue: calculation.grandTotal,
      totalInWords: calculation.totalInWords,
      countryOfDestination: countryOfDestination || resolvedCustomer.country || '',
      portOfDischarge: portOfDischarge || '',
      shippingMarks: shippingMarks || linkedOrder?.shippingMarks || '',
      notes: notes || '',
      termsAndConditions: termsAndConditions || undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
    });

    await invoice.save();

    // If order-linked, update Order's invoice sub-document directly
    if (linkedOrder) {
      linkedOrder.invoice = {
        invoiceId: invoice.invoiceNumber,
        pdfUrl: `/api/invoices/${invoice._id}/pdf`,
        status: invoice.status,
        isPending: false,
        lastAttemptAt: new Date(),
        error: null,
      };
      await linkedOrder.save();
    }

    logger.info(`Invoice #${invoice.invoiceNumber} created (${invoice.docType})`, {
      invoiceId: invoice._id,
      grandTotal: invoice.grandTotal,
      user: targetUser,
    });

    return res.status(201).json({
      success: true,
      message: `Invoice #${invoice.invoiceNumber} generated successfully.`,
      invoice,
    });
  } catch (error) {
    logger.error('Error creating invoice', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get all Invoices (scoped to current buyer unless staff)
// @route GET /api/invoices
export const getInvoices = async (req, res) => {
  try {
    const { status, orderId, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    // Buyer scoping: strictly enforce IDOR isolation
    if (!isStaffUser(req.user)) {
      filter.user = req.user._id;
    }

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (orderId) {
      filter.order = orderId;
    }

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { invoiceNumber: searchRegex },
        { 'customerDetails.customerName': searchRegex },
        { 'customerDetails.businessName': searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('order', 'orderNumber status orderType')
        .populate('user', 'username email customerName businessName'),
      Invoice.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: invoices.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: invoices,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get single Invoice by ID (with strict IDOR check)
// @route GET /api/invoices/:id
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('order', 'orderNumber status orderType totalAmount currency')
      .populate('user', 'username email customerName businessName');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Strict ownership verification
    const invoiceUserId = invoice.user?._id ? invoice.user._id.toString() : invoice.user?.toString();
    const reqUserId = req.user?._id?.toString();
    const isStaff = isStaffUser(req.user);

    if (invoiceUserId !== reqUserId && !isStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this invoice' });
    }

    return res.status(200).json({ success: true, invoice });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update Invoice details (recalculates totals server-side)
// @route PUT /api/invoices/:id
export const updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const isStaff = isStaffUser(req.user);
    if (!isStaff) {
      return res.status(403).json({ success: false, message: 'Only staff can modify invoice records' });
    }

    if (invoice.status === 'void') {
      return res.status(400).json({ success: false, message: 'Cannot modify a voided invoice' });
    }

    const {
      docType,
      currency,
      incoterm,
      customerDetails,
      discountType,
      discountValue,
      taxRate,
      items,
      status,
      notes,
      termsAndConditions,
      shippingMarks,
      dueDate,
    } = req.body;

    if (docType) invoice.docType = docType;
    if (currency) invoice.currency = currency;
    if (incoterm) invoice.incoterm = incoterm;
    if (customerDetails) invoice.customerDetails = { ...invoice.customerDetails, ...customerDetails };
    if (notes !== undefined) invoice.notes = notes;
    if (termsAndConditions !== undefined) invoice.termsAndConditions = termsAndConditions;
    if (shippingMarks !== undefined) invoice.shippingMarks = shippingMarks;
    if (dueDate) invoice.dueDate = new Date(dueDate);
    if (status && ['draft', 'sent'].includes(status)) invoice.status = status;

    if (items || discountType !== undefined || discountValue !== undefined || taxRate !== undefined) {
      const itemsToCalc = items || invoice.items;
      const calculation = calculateInvoiceTotals({
        items: itemsToCalc,
        docType: invoice.docType,
        currency: invoice.currency,
        discountType: discountType || invoice.discountType,
        discountValue: discountValue !== undefined ? discountValue : invoice.discountValue,
        taxRate: taxRate !== undefined ? taxRate : invoice.taxRate,
        senderStateCode: process.env.SENDER_STATE_CODE || '03',
        recipientStateCode: invoice.customerDetails?.stateCode || '',
      });

      invoice.items = calculation.items;
      invoice.totalQuantity = calculation.totalQty;
      invoice.subtotal = calculation.subtotal;
      invoice.discountType = discountType || invoice.discountType;
      invoice.discountValue = discountValue !== undefined ? discountValue : invoice.discountValue;
      invoice.discountAmount = calculation.discountAmount;
      invoice.taxableAmount = calculation.taxableAmount;
      invoice.taxRate = taxRate !== undefined ? taxRate : invoice.taxRate;
      invoice.taxAmount = calculation.taxAmount;
      invoice.isIgst = calculation.isIgst;
      invoice.cgstAmount = calculation.cgstAmount;
      invoice.sgstAmount = calculation.sgstAmount;
      invoice.igstAmount = calculation.igstAmount;
      invoice.roundOff = calculation.roundOff;
      invoice.grandTotal = calculation.grandTotal;
      invoice.balanceDue = Math.max(0, roundToTwoDecimals(calculation.grandTotal - (invoice.amountPaid || 0)));
      invoice.totalInWords = calculation.totalInWords;
    }

    await invoice.save();
    return res.status(200).json({ success: true, message: 'Invoice updated successfully', invoice });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Record a payment against an invoice
// @route POST /api/invoices/:id/payments
export const recordPayment = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (!isStaffUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Only staff can record payments' });
    }

    if (invoice.status === 'void') {
      return res.status(400).json({ success: false, message: 'Cannot record payment on a voided invoice' });
    }

    const { amount, paymentMethod = 'Wire Transfer', paymentDate, referenceNumber = '', notes = '' } = req.body;
    const paymentAmount = roundToTwoDecimals(Number(amount));

    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid positive payment amount is required' });
    }

    invoice.payments.push({
      amount: paymentAmount,
      paymentMethod,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      referenceNumber,
      notes,
      recordedBy: req.user.customerName || req.user.username,
    });

    invoice.amountPaid = roundToTwoDecimals((invoice.amountPaid || 0) + paymentAmount);
    invoice.balanceDue = Math.max(0, roundToTwoDecimals(invoice.grandTotal - invoice.amountPaid));

    if (invoice.balanceDue <= 0.001) {
      invoice.status = 'paid';
    } else {
      invoice.status = 'partial';
    }

    await invoice.save();

    // Update linked order if exists
    if (invoice.order) {
      await Order.findByIdAndUpdate(invoice.order, {
        'invoice.status': invoice.status,
      });
    }

    logger.info(`Payment of ${paymentAmount} recorded on Invoice #${invoice.invoiceNumber}`, {
      invoiceId: invoice._id,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.balanceDue,
      status: invoice.status,
    });

    return res.status(200).json({
      success: true,
      message: `Payment of ${invoice.currency} ${paymentAmount.toFixed(2)} recorded successfully.`,
      invoice,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Void an Invoice
// @route POST /api/invoices/:id/void
export const voidInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (!isStaffUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Only staff can void invoices' });
    }

    const { reason } = req.body;
    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'A reason (min 3 chars) is required to void an invoice' });
    }

    invoice.status = 'void';
    invoice.voidReason = reason.trim();
    invoice.voidedAt = new Date();
    invoice.voidedBy = req.user.customerName || req.user.username;

    await invoice.save();

    if (invoice.order) {
      await Order.findByIdAndUpdate(invoice.order, {
        'invoice.status': 'void',
      });
    }

    logger.info(`Invoice #${invoice.invoiceNumber} VOIDED`, {
      invoiceId: invoice._id,
      voidedBy: invoice.voidedBy,
      reason: invoice.voidReason,
    });

    return res.status(200).json({
      success: true,
      message: `Invoice #${invoice.invoiceNumber} has been voided.`,
      invoice,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Download Commercial / GST Invoice PDF
// @route GET /api/invoices/:id/pdf
export const downloadInvoicePdf = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Ownership check
    const invoiceUserId = invoice.user?._id ? invoice.user._id.toString() : invoice.user?.toString();
    const reqUserId = req.user?._id?.toString();
    const isStaff = isStaffUser(req.user);

    if (invoiceUserId !== reqUserId && !isStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized to download this invoice' });
    }

    const pdfBuffer = await generateCommercialInvoicePdf(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="HAO_Invoice_${invoice.invoiceNumber}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    logger.error('Error generating invoice PDF', { error: error.message });
    return res.status(500).json({ success: false, message: 'Failed to generate invoice PDF: ' + error.message });
  }
};
