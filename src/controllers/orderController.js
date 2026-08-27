import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { generateOrderPdf } from '../utils/pdfGenerator.js';

// Helper to generate sequential-style Order Number
const generateOrderNumber = () => {
  const year = new Date().getFullYear();
  const randomPart = Math.floor(100000 + Math.random() * 900000);
  return `HAO-${year}-${randomPart}`;
};

// @desc Create a new customized order
// @route POST /api/orders
export const createOrder = async (req, res) => {
  try {
    const {
      items,
      shippingMarks,
      specialInstructions,
      customerDetailsOverride,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your order must contain at least one item.',
      });
    }

    let totalQuantity = 0;
    let totalAmount = 0;
    let estimatedWeightKg = 0;
    let estimatedCartons = 0;

    const validatedItems = [];

    for (const item of items) {
      const quantity = parseInt(item.quantity);
      if (!quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for item ${item.productName || item.sku}`,
        });
      }

      // Fetch base product if ID available for exact pricing/weight
      let unitPrice = Number(item.unitPrice) || 0;
      let weightKg = 1.0;
      let pcsPerCarton = 20;

      if (item.product) {
        const prod = await Product.findById(item.product);
        if (prod) {
          if (!unitPrice) unitPrice = prod.basePrice;
          weightKg = prod.weightKg || 1.0;
          pcsPerCarton = prod.pcsPerCarton || 20;
        }
      }

      const itemTotal = unitPrice * quantity;
      totalQuantity += quantity;
      totalAmount += itemTotal;
      estimatedWeightKg += (weightKg * quantity);
      estimatedCartons += Math.ceil(quantity / pcsPerCarton);

      validatedItems.push({
        product: item.product || null,
        productName: item.productName || 'Hand Tool',
        sku: item.sku || 'N/A',
        size: item.size || 'Standard',
        finish: item.finish || 'Standard',
        color: item.color || 'Standard',
        brand: item.brand || 'H.A. Overseas',
        quantity: quantity,
        unitPrice: unitPrice,
        totalPrice: itemTotal,
        packaging: item.packaging || 'Master Carton',
        customMarking: item.customMarking || '',
        itemNotes: item.itemNotes || '',
      });
    }

    const orderNumber = generateOrderNumber();

    const customerDetails = {
      customerName: customerDetailsOverride?.customerName || req.user.customerName,
      businessName: customerDetailsOverride?.businessName || req.user.businessName,
      country: customerDetailsOverride?.country || req.user.country,
      phoneNumber: customerDetailsOverride?.phoneNumber || req.user.phoneNumber,
      address: customerDetailsOverride?.address || req.user.address,
      email: req.user.email,
    };

    const order = new Order({
      orderNumber,
      user: req.user._id,
      customerDetails,
      items: validatedItems,
      totalQuantity,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      currency: 'USD',
      estimatedWeightKg: parseFloat(estimatedWeightKg.toFixed(2)),
      estimatedCartons,
      shippingMarks: shippingMarks || '',
      specialInstructions: specialInstructions || '',
      status: 'Submitted',
      timeline: [
        {
          status: 'Submitted',
          updatedBy: req.user.customerName || req.user.username,
          updatedAt: new Date(),
          note: 'Order submitted online by buyer',
        },
      ],
    });

    await order.save();

    return res.status(201).json({
      success: true,
      message: `Order #${orderNumber} submitted successfully! Our export desk will review your specifications.`,
      order,
    });
  } catch (error) {
    console.error('[Create Order Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get logged-in user orders
// @route GET /api/orders/my-orders
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get single order by ID
// @route GET /api/orders/:id
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'username email customerName businessName');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check ownership or admin
    if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to view this order' });
    }

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get all orders (Admin)
// @route GET /api/orders
export const getAllOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { orderNumber: searchRegex },
        { 'customerDetails.customerName': searchRegex },
        { 'customerDetails.businessName': searchRegex },
        { 'customerDetails.country': searchRegex },
      ];
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'username email customerName businessName');

    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update Order Status (Admin)
// @route PATCH /api/orders/:id/status
export const updateOrderStatus = async (req, res) => {
  try {
    const { status, note, adminNotes } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (status) {
      order.status = status;
      order.timeline.push({
        status,
        updatedBy: req.user.customerName || req.user.username,
        updatedAt: new Date(),
        note: note || `Status updated to ${status}`,
      });
    }

    if (adminNotes !== undefined) {
      order.adminNotes = adminNotes;
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status}`,
      data: order,
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

    if (orderUserId !== reqUserId && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to download this order PDF' });
    }

    const pdfBuffer = await generateOrderPdf(order);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="HAO_Order_${order.orderNumber}.pdf"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('[Download PDF Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get Admin Dashboard Statistics
// @route GET /api/orders/stats/summary
export const getAdminStats = async (req, res) => {
  try {
    const [totalOrders, pendingOrders, completedOrders, productsCount] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: { $in: ['Submitted', 'Under Review'] } }),
      Order.countDocuments({ status: { $in: ['Confirmed', 'In Production', 'Dispatched', 'Completed'] } }),
      Product.countDocuments(),
    ]);

    const aggregateAmounts = await Order.aggregate([
      { $group: { _id: null, totalVal: { $sum: '$totalAmount' }, totalUnits: { $sum: '$totalQuantity' } } },
    ]);

    const totalRevenue = aggregateAmounts[0]?.totalVal || 0;
    const totalUnitsSold = aggregateAmounts[0]?.totalUnits || 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalOrders,
        pendingOrders,
        completedOrders,
        productsCount,
        totalRevenue,
        totalUnitsSold,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
