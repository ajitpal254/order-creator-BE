import mongoose from 'mongoose';
import { OrderTemplate } from '../models/OrderTemplate.js';
import { Order } from '../models/Order.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';
import { deepCopyItems, saveDraftOrder } from '../utils/draftOrder.js';
import { logger } from '../utils/logger.js';

/**
 * Order templates (FEAT-05, v0.5) — /api/templates.
 *
 * Every route is authenticated (protect) and owner-scoped: templates
 * are only ever queried with { user: req.user._id }, so another user's
 * template is indistinguishable from a missing one (404, SEC-01).
 */

const round2 = (n) => parseFloat(n.toFixed(2));

const findOwnTemplate = (id, userId) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return OrderTemplate.findOne({ _id: id, user: userId });
};

// @desc List the caller's templates (paginated envelope)
// @route GET /api/templates
export const getMyTemplates = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    const { page, limit, skip } = parsePagination(req);
    const [templates, total] = await Promise.all([
      OrderTemplate.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      OrderTemplate.countDocuments(filter),
    ]);
    return paginatedResponse(res, { items: templates, total, page, limit });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Create a template from explicit items or by snapshotting an own order
// @route POST /api/templates
export const createTemplate = async (req, res) => {
  try {
    const { name, items, fromOrderId } = req.body;

    let templateItems;
    if (fromOrderId) {
      // Snapshot an existing order — own orders only (404 otherwise).
      if (!mongoose.isValidObjectId(fromOrderId)) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      const sourceOrder = await Order.findOne({ _id: fromOrderId, user: req.user._id });
      if (!sourceOrder) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      templateItems = deepCopyItems(sourceOrder.items);
    } else if (Array.isArray(items) && items.length > 0) {
      templateItems = deepCopyItems(items).map((item) => ({
        ...item,
        // Keep the stored total consistent when the caller sent only a
        // unit price (same unitPrice × quantity the item itself states).
        totalPrice:
          item.totalPrice ?? round2((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)),
      }));
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide either items or fromOrderId to create a template.',
      });
    }

    const template = await OrderTemplate.create({
      user: req.user._id,
      name,
      items: templateItems,
    });

    return res.status(201).json({ success: true, data: template });
  } catch (error) {
    logger.error('Error creating order template', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Delete one of the caller's templates
// @route DELETE /api/templates/:id
export const deleteTemplate = async (req, res) => {
  try {
    const template = await findOwnTemplate(req.params.id, req.user._id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    await template.deleteOne();
    return res.status(200).json({ success: true, message: 'Template deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Create a Draft order from one of the caller's templates
// @route POST /api/templates/:id/create-order
export const createOrderFromTemplate = async (req, res) => {
  try {
    const template = await findOwnTemplate(req.params.id, req.user._id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    if (!template.items || template.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'This template has no items to create an order from.',
      });
    }

    // Totals are sums of the template's STORED item prices — no catalog
    // or tier repricing (see utils/draftOrder.js).
    const items = deepCopyItems(template.items).map((item) => ({
      ...item,
      totalPrice:
        item.totalPrice ?? round2((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)),
    }));
    const totalQuantity = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    const totalAmount = round2(items.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0));

    const order = await saveDraftOrder({
      userId: req.user._id,
      orderType: 'Order',
      items,
      totals: {
        totalQuantity,
        subtotalAmount: totalAmount,
        discountPercent: 0,
        discountAmount: 0,
        totalAmount,
        estimatedWeightKg: 0,
        estimatedCartons: 0,
      },
      currency: 'USD',
      currencyRate: 1.0,
      incoterm: 'FOB',
      customerDetails: {
        customerName: req.user.customerName,
        businessName: req.user.businessName,
        country: req.user.country,
        phoneNumber: req.user.phoneNumber,
        address: req.user.address,
        email: req.user.email,
      },
      distributorTierSnapshot: req.user.distributorTier || 'Standard',
      updatedBy: req.user.customerName || req.user.username,
      note: `Draft created from template "${template.name}"`,
    });

    logger.info(`Draft order ${order.orderNumber} created from template ${template._id}`, {
      orderId: order._id,
      userId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: `Draft order #${order.orderNumber} created from template "${template.name}".`,
      data: order,
      order,
    });
  } catch (error) {
    logger.error('Error creating order from template', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};
