/**
 * Export document generators registry (FEAT-08, v0.8).
 *
 * Maps each generatable OrderDocument type to its standalone generator
 * and its user-facing title. 'custom' is intentionally absent: custom
 * documents only ever arrive via upload, never via generation.
 */
import { generatePackingList } from './packingList.js';
import { generateExportCommercialInvoice } from './exportCommercialInvoice.js';
import { generateCertificateOfOrigin } from './certificateOfOrigin.js';
import { generateShippingLabels } from './shippingLabels.js';

export const EXPORT_DOCUMENT_GENERATORS = {
  packing_list: generatePackingList,
  export_commercial_invoice: generateExportCommercialInvoice,
  certificate_of_origin: generateCertificateOfOrigin,
  shipping_labels: generateShippingLabels,
};

export const DOCUMENT_TITLES = {
  packing_list: 'Packing List',
  export_commercial_invoice: 'Export Commercial Invoice',
  certificate_of_origin: 'Certificate of Origin',
  shipping_labels: 'Shipping Labels',
  custom: 'Custom Document',
};

export const GENERATABLE_TYPES = Object.keys(EXPORT_DOCUMENT_GENERATORS);

export {
  generatePackingList,
  generateExportCommercialInvoice,
  generateCertificateOfOrigin,
  generateShippingLabels,
};
