import mongoose from 'mongoose';

/**
 * OrderDocument (FEAT-08, v0.8) — the document vault for an order.
 *
 * One row per stored artefact: either a system-generated export
 * document (packing list, export commercial invoice, certificate of
 * origin data sheet, shipping-mark labels) rendered by the standalone
 * generators in src/utils/exportDocs/, or a file uploaded through the
 * hardened upload path. The binary itself lives in the storage service
 * (src/services/storage.js); this row only keeps its key + metadata.
 *
 * Versioning: documents are never overwritten. A new document of the
 * same (order, type) gets version = max(existing versions) + 1, for
 * generated documents and uploads alike (first document is version 1).
 */
export const ORDER_DOCUMENT_TYPES = [
  'packing_list',
  'export_commercial_invoice',
  'certificate_of_origin',
  'shipping_labels',
  'custom',
];

const orderDocumentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ORDER_DOCUMENT_TYPES,
      required: true,
    },
    title: {
      type: String,
      default: '',
    },
    storageKey: {
      type: String,
      required: true,
    },
    // MIME type served on download. Generated documents are always
    // application/pdf; uploads keep the type sniffed at upload time.
    contentType: {
      type: String,
      default: 'application/pdf',
    },
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    generatedFrom: {
      type: String,
      enum: ['system', 'upload'],
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

orderDocumentSchema.index({ order: 1, type: 1, version: -1 });
orderDocumentSchema.index({ order: 1, createdAt: -1 });

/**
 * Next version for an (order, type) pair: max existing version + 1,
 * or 1 when the vault has no document of that type yet.
 */
export const nextDocumentVersion = async (orderId, type) => {
  const latest = await OrderDocument.findOne({ order: orderId, type })
    .sort({ version: -1 })
    .select('version')
    .lean();
  return (latest?.version || 0) + 1;
};

export const OrderDocument = mongoose.model('OrderDocument', orderDocumentSchema);
