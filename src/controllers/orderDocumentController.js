import { Order } from '../models/Order.js';
import { OrderDocument, ORDER_DOCUMENT_TYPES, nextDocumentVersion } from '../models/OrderDocument.js';
import {
  EXPORT_DOCUMENT_GENERATORS,
  DOCUMENT_TITLES,
  GENERATABLE_TYPES,
} from '../utils/exportDocs/index.js';
import { storage } from '../services/storage.js';
import { IMAGE_TYPES } from '../utils/imageSniff.js';
import { logAudit } from '../utils/audit.js';
import { logger } from '../utils/logger.js';

// Staff roles — mirrors STAFF_ROLES in orderController.js: holders of
// these roles act on any user's orders; everyone else may only access
// their own orders, and another buyer's order is reported as 404.
const STAFF_ROLES = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

export const isStaffUser = (user) => STAFF_ROLES.includes(user?.role);

/**
 * Load the order for a document request, enforcing the standard order
 * access rule (owner or staff; anyone else gets a 404). Returns null
 * after sending the 404 response when access is denied / not found.
 */
const loadAccessibleOrder = async (req, res) => {
  const order = await Order.findById(req.params.id).catch(() => null);
  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return null;
  }
  if (!isStaffUser(req.user) && order.user.toString() !== req.user._id.toString()) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return null;
  }
  return order;
};

const serializeDocument = (doc) => ({
  _id: doc._id,
  order: doc.order,
  type: doc.type,
  title: doc.title,
  storageKey: doc.storageKey,
  contentType: doc.contentType,
  version: doc.version,
  generatedFrom: doc.generatedFrom,
  createdBy: doc.createdBy,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// @desc Generate an export document (packing list / export commercial
// invoice / certificate of origin / shipping labels) from order data,
// store the PDF via the storage service and vault it as the next
// version for its (order, type).
// @route POST /api/orders/:id/documents/generate
export const generateOrderDocument = async (req, res) => {
  try {
    const order = await loadAccessibleOrder(req, res);
    if (!order) return;

    const { type } = req.body || {};
    if (!GENERATABLE_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type. Generatable types: ${GENERATABLE_TYPES.join(', ')}`,
      });
    }

    const generator = EXPORT_DOCUMENT_GENERATORS[type];
    const buffer = await generator(order);
    if (!buffer || buffer.length === 0 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Document generator did not produce a PDF');
    }

    const version = await nextDocumentVersion(order._id, type);
    const storageKey = `order-docs/${order._id}/${type}_v${version}.pdf`;
    await storage.put(storageKey, buffer, 'application/pdf');

    const doc = await OrderDocument.create({
      order: order._id,
      type,
      title: `${DOCUMENT_TITLES[type]} — ${order.orderNumber} (v${version})`,
      storageKey,
      contentType: 'application/pdf',
      version,
      generatedFrom: 'system',
      createdBy: req.user._id,
    });

    await logAudit(req, {
      action: 'order.document.generate',
      entityType: 'OrderDocument',
      entityId: doc._id,
      after: { order: order._id.toString(), type, version },
    });

    return res.status(201).json({ success: true, data: serializeDocument(doc) });
  } catch (error) {
    logger.error('Error generating order document', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc List an order's document vault, newest first
// @route GET /api/orders/:id/documents
export const listOrderDocuments = async (req, res) => {
  try {
    const order = await loadAccessibleOrder(req, res);
    if (!order) return;

    const docs = await OrderDocument.find({ order: order._id }).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: docs.length,
      data: docs.map(serializeDocument),
    });
  } catch (error) {
    logger.error('Error listing order documents', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Download one vault document (streamed from the storage service)
// @route GET /api/orders/:id/documents/:docId/download
export const downloadOrderDocument = async (req, res) => {
  try {
    const order = await loadAccessibleOrder(req, res);
    if (!order) return;

    const doc = await OrderDocument.findOne({ _id: req.params.docId, order: order._id }).catch(
      () => null
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    let stream;
    try {
      stream = await storage.getStream(doc.storageKey);
    } catch {
      return res.status(404).json({ success: false, message: 'Document file not found' });
    }

    const safeTitle = (doc.title || doc.type).replace(/[^\w.\- ]+/g, '').trim() || doc.type;
    const ext = doc.contentType === 'application/pdf' ? '.pdf' : '';
    res.setHeader('Content-Type', doc.contentType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeTitle}${ext}"`
    );
    stream.on('error', (err) => {
      logger.error('Error streaming order document', { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error downloading document' });
      } else {
        res.destroy(err);
      }
    });
    return stream.pipe(res);
  } catch (error) {
    logger.error('Error downloading order document', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

const UPLOAD_CONTENT_TYPES = {
  pdf: 'application/pdf',
  ...Object.fromEntries(Object.entries(IMAGE_TYPES).map(([k, v]) => [k, v.mime])),
};

// @desc Upload a document into an order's vault. The file has already
// been validated by magic-byte sniffing and stored through the storage
// service by the hardened upload middleware (middleware/proofUpload.js,
// shared with payment proofs: PDF + JPEG/PNG/WebP).
// @route POST /api/orders/:id/documents/upload
export const uploadOrderDocument = async (req, res) => {
  try {
    const order = await loadAccessibleOrder(req, res);
    if (!order) {
      // The middleware stores the file before we can check access —
      // remove the orphaned upload when the order is not accessible.
      if (req.file?.filename) await storage.delete(req.file.filename).catch(() => {});
      return;
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Document file is required' });
    }

    const requestedType = req.body?.type;
    const type = ORDER_DOCUMENT_TYPES.includes(requestedType) ? requestedType : 'custom';
    const version = await nextDocumentVersion(order._id, type);
    const contentType =
      UPLOAD_CONTENT_TYPES[req.file.sniffedType] || req.file.mimetype || 'application/octet-stream';

    const doc = await OrderDocument.create({
      order: order._id,
      type,
      title:
        (req.body?.title || '').toString().trim() ||
        req.file.originalname ||
        `${DOCUMENT_TITLES[type]} — ${order.orderNumber} (v${version})`,
      storageKey: req.file.filename,
      contentType,
      version,
      generatedFrom: 'upload',
      createdBy: req.user._id,
    });

    await logAudit(req, {
      action: 'order.document.upload',
      entityType: 'OrderDocument',
      entityId: doc._id,
      after: { order: order._id.toString(), type, version },
    });

    return res.status(201).json({ success: true, data: serializeDocument(doc) });
  } catch (error) {
    logger.error('Error uploading order document', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Delete a vault document (staff only — enforced in routes).
// Removes the row and best-effort deletes the stored file.
// @route DELETE /api/orders/:id/documents/:docId
export const deleteOrderDocument = async (req, res) => {
  try {
    const order = await loadAccessibleOrder(req, res);
    if (!order) return;

    const doc = await OrderDocument.findOne({ _id: req.params.docId, order: order._id }).catch(
      () => null
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    await OrderDocument.deleteOne({ _id: doc._id });
    await storage.delete(doc.storageKey).catch(() => {});

    await logAudit(req, {
      action: 'order.document.delete',
      entityType: 'OrderDocument',
      entityId: doc._id,
      before: { order: order._id.toString(), type: doc.type, version: doc.version },
    });

    return res.status(200).json({ success: true, message: 'Document deleted' });
  } catch (error) {
    logger.error('Error deleting order document', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};
