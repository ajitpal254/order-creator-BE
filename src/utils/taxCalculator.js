import { numberToWordsIndian, numberToWordsInternational } from './numberToWords.js';

/**
 * Server-side financial & tax recalculation utility.
 * Strictly prevents floating-point inaccuracies and client-side tampering.
 */
export function roundToTwoDecimals(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export function calculateInvoiceTotals(invoiceData) {
  const items = Array.isArray(invoiceData.items) ? invoiceData.items : [];
  const docType = invoiceData.docType || 'commercial_invoice';
  const defaultTaxRate = Number(invoiceData.taxRate) >= 0 ? Number(invoiceData.taxRate) : 0;
  const discountType = invoiceData.discountType || 'amount';
  const discountValue = Number(invoiceData.discountValue) > 0 ? Number(invoiceData.discountValue) : 0;
  const currency = invoiceData.currency || 'USD';

  let rawTaxAmount = 0;
  let subtotal = 0;
  let totalQty = 0;

  const recalculatedItems = items.map((item) => {
    const quantity = Number(item.quantity ?? item.qty) || 0;
    const unitPrice = Number(item.unitPrice ?? item.price) || 0;
    const discountPercent = Number(item.discountPercent ?? item.discRate) || 0;

    const lineSubtotal = roundToTwoDecimals(quantity * unitPrice);
    const lineDiscount = roundToTwoDecimals(lineSubtotal * (discountPercent / 100));
    const lineNet = roundToTwoDecimals(lineSubtotal - lineDiscount);

    const itemTaxRate = (item.taxRate !== undefined && item.taxRate !== null && item.taxRate !== '')
      ? (Number(item.taxRate) || 0)
      : defaultTaxRate;

    const lineTax = roundToTwoDecimals(lineNet * (itemTaxRate / 100));
    const lineTotal = roundToTwoDecimals(lineNet + (docType === 'gst_invoice' || docType === 'standard_invoice' ? lineTax : 0));

    totalQty += quantity;
    subtotal += lineNet;
    rawTaxAmount += lineTax;

    return {
      product: item.product || null,
      productName: item.productName || item.description || 'Industrial Tool',
      description: item.productName || item.description || 'Industrial Tool',
      sku: item.sku || 'N/A',
      hsnCode: item.hsnCode || '8205.59',
      quantity,
      unit: item.unit || 'PCS',
      unitPrice,
      discountPercent,
      taxRate: itemTaxRate,
      lineSubtotal,
      lineDiscount,
      lineNet,
      lineTax,
      lineTotal,
    };
  });

  subtotal = roundToTwoDecimals(subtotal);
  rawTaxAmount = roundToTwoDecimals(rawTaxAmount);

  let discountAmount = 0;
  if (discountValue > 0) {
    if (discountType === 'percent') {
      discountAmount = roundToTwoDecimals(subtotal * (discountValue / 100));
    } else {
      discountAmount = roundToTwoDecimals(discountValue);
    }
  }

  const taxableAmount = roundToTwoDecimals(Math.max(0, subtotal - discountAmount));
  const discountRatio = subtotal > 0 ? (taxableAmount / subtotal) : 1;
  const totalCalculatedTax = roundToTwoDecimals(rawTaxAmount * discountRatio);

  // GST State Code comparison
  const senderStateCode = invoiceData.senderStateCode || '03'; // Punjab (H.A. Overseas HQ)
  const recipientStateCode = invoiceData.recipientStateCode || '';
  const isIgst = !(senderStateCode && recipientStateCode && senderStateCode === recipientStateCode);

  let taxAmount = 0;
  let igstAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;

  if (docType === 'gst_invoice') {
    taxAmount = totalCalculatedTax;
    if (isIgst) {
      igstAmount = totalCalculatedTax;
    } else {
      cgstAmount = roundToTwoDecimals(totalCalculatedTax / 2);
      sgstAmount = roundToTwoDecimals(totalCalculatedTax - cgstAmount);
    }
  } else if (docType === 'standard_invoice') {
    taxAmount = totalCalculatedTax;
  } else {
    // Commercial and Proforma invoices for export: zero-rated tax
    taxAmount = 0;
  }

  const shippingCharges = Number(invoiceData.shippingCharges) > 0 ? roundToTwoDecimals(Number(invoiceData.shippingCharges)) : 0;

  const exactGrandTotal = roundToTwoDecimals(taxableAmount + taxAmount + shippingCharges);
  const roundedGrandTotal = Math.round(exactGrandTotal);
  const roundOff = roundToTwoDecimals(roundedGrandTotal - exactGrandTotal);
  const grandTotal = docType === 'gst_invoice' ? roundedGrandTotal : exactGrandTotal;

  // Words formatting
  const totalInWords = currency === 'INR'
    ? numberToWordsIndian(grandTotal)
    : numberToWordsInternational(grandTotal, `TOTAL ${currency}: `);

  return {
    items: recalculatedItems,
    totalQty,
    subtotal,
    discountAmount,
    taxableAmount,
    shippingCharges,
    isIgst,
    igstAmount,
    cgstAmount,
    sgstAmount,
    taxAmount,
    roundOff,
    grandTotal,
    exactGrandTotal,
    totalInWords,
  };
}

export function getExportNote(docType = 'commercial_invoice', shippingBillType = 'W PAY') {
  if (docType === 'commercial_invoice') {
    return 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX / UNDER LETTER OF UNDERTAKING (LUT) WITHOUT PAYMENT OF INTEGRATED TAX';
  }
  if (docType === 'gst_invoice') {
    return shippingBillType === 'WO PAY'
      ? 'SUPPLY MEANT FOR EXPORT UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX'
      : 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX';
  }
  return 'ZERO RATED EXPORT SUPPLY';
}
