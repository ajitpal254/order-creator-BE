import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const generateOrderPdf = (order) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        bufferPages: true,
        autoFirstPage: true,
      });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 515.28

      const isQuote = order.orderType === 'Quote';
      const currency = order.currency || 'USD';
      const incoterm = order.incoterm || 'FOB';

      // Helper function to draw Header
      const drawHeader = () => {
        // Dark Navy Header Banner
        doc.rect(MARGIN, MARGIN, CONTENT_WIDTH, 68).fill('#0F172A');
        
        // Gold Brand Accent Bar
        doc.rect(MARGIN, MARGIN + 68, CONTENT_WIDTH, 3).fill('#D97706');

        // Brand Title
        doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('H.A. OVERSEAS', MARGIN + 16, MARGIN + 12);
        doc.fontSize(8.5).font('Helvetica').fillColor('#94A3B8').text(
          'Manufacturers & Exporters of Precision Hand Tools, Grease Guns & Engineering Hardware',
          MARGIN + 16,
          MARGIN + 33
        );
        doc.fontSize(7.5).fillColor('#CBD5E1').text(
          'Web: https://haoverseas.com   |   Email: haoverseas1313@gmail.com   |   Phone: +91-99884-65800, +91-99888-70308',
          MARGIN + 16,
          MARGIN + 48
        );

        // Official HA Logo
        try {
          const logoPath = path.resolve(process.cwd(), 'src/assets/logo.jpg');
          if (fs.existsSync(logoPath)) {
            doc.rect(MARGIN + CONTENT_WIDTH - 64, MARGIN + 9, 50, 50).fill('#FFFFFF');
            doc.image(logoPath, MARGIN + CONTENT_WIDTH - 62, MARGIN + 11, { fit: [46, 46], align: 'center', valign: 'center' });
          }
        } catch (e) {
          // fallback gracefully
        }
      };

      drawHeader();

      // Top Section: Order Meta & Buyer Info
      let y = MARGIN + 82;

      // 1. Order Info Card (Left)
      const colWidth = (CONTENT_WIDTH - 15) / 2;
      doc.rect(MARGIN, y, colWidth, 92).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text(
        isQuote ? 'REQUEST FOR QUOTE (RFQ)' : 'ORDER CONFIRMATION',
        MARGIN + 12,
        y + 10
      );
      
      doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
      doc.text('Document #:', MARGIN + 12, y + 26);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(order.orderNumber || 'N/A', MARGIN + 85, y + 26);

      doc.font('Helvetica').fillColor('#475569').text('Incoterm & Cur:', MARGIN + 12, y + 40);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${incoterm} (${currency})`, MARGIN + 85, y + 40);

      doc.font('Helvetica').fillColor('#475569').text('Date:', MARGIN + 12, y + 54);
      doc.font('Helvetica').fillColor('#0F172A').text(
        new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        MARGIN + 85,
        y + 54
      );

      doc.font('Helvetica').fillColor('#475569').text('Status:', MARGIN + 12, y + 68);
      doc.font('Helvetica-Bold').fillColor('#D97706').text((order.status || 'SUBMITTED').toUpperCase(), MARGIN + 85, y + 68);

      // 2. Buyer Details Card (Right)
      const rightX = MARGIN + colWidth + 15;
      doc.rect(rightX, y, colWidth, 92).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text('BUYER / CONSIGNEE', rightX + 12, y + 10);

      doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
      const cust = order.customerDetails || {};
      doc.text(`Contact: ${cust.customerName || 'N/A'}`, rightX + 12, y + 26);
      doc.font('Helvetica-Bold').text(`Company: ${cust.businessName || 'N/A'}`, rightX + 12, y + 40);
      doc.font('Helvetica').text(`Country: ${cust.country || 'N/A'} | Phone: ${cust.phoneNumber || 'N/A'}`, rightX + 12, y + 54);
      doc.fontSize(7.5).fillColor('#64748B').text(`Address: ${cust.address || 'N/A'}`, rightX + 12, y + 68, { width: colWidth - 24, lineBreak: false, ellipsis: true });

      y += 105;

      // Table Column Specifications
      const COLS = {
        num: { x: MARGIN, w: 24, align: 'center' },
        item: { x: MARGIN + 26, w: 160, align: 'left' },
        specs: { x: MARGIN + 190, w: 85, align: 'left' },
        finish: { x: MARGIN + 280, w: 95, align: 'left' },
        qty: { x: MARGIN + 380, w: 40, align: 'right' },
        price: { x: MARGIN + 425, w: 42, align: 'right' },
        total: { x: MARGIN + 472, w: 43, align: 'right' },
      };

      const drawTableHeader = (curY) => {
        doc.rect(MARGIN, curY, CONTENT_WIDTH, 22).fill('#1E293B');
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        doc.text('#', COLS.num.x, curY + 6, { width: COLS.num.w, align: 'center' });
        doc.text('ITEM / SKU / BRAND', COLS.item.x, curY + 6, { width: COLS.item.w });
        doc.text('SIZE / SPECS', COLS.specs.x, curY + 6, { width: COLS.specs.w });
        doc.text('FINISH & COLOR', COLS.finish.x, curY + 6, { width: COLS.finish.w });
        doc.text('QTY', COLS.qty.x, curY + 6, { width: COLS.qty.w, align: 'right' });
        doc.text('PRICE', COLS.price.x, curY + 6, { width: COLS.price.w, align: 'right' });
        doc.text('TOTAL', COLS.total.x, curY + 6, { width: COLS.total.w, align: 'right' });
        return curY + 24;
      };

      y = drawTableHeader(y);

      // Render Items with Dynamic Height Calculation
      (order.items || []).forEach((item, index) => {
        const productName = item.productName || 'Industrial Tool';
        const metaParts = [];
        if (item.sku) metaParts.push(`SKU: ${item.sku}`);
        if (item.brand) metaParts.push(`Brand: ${item.brand}`);
        if (item.customMarking) metaParts.push(`Marking: "${item.customMarking}"`);
        const metaText = metaParts.join(' | ');

        const sizeText = item.size || 'Standard';
        const finishColorText = `${item.finish || 'Standard'}\n${item.color || 'Standard'}`;

        // Calculate dynamic line heights
        doc.font('Helvetica-Bold').fontSize(8);
        const nameH = doc.heightOfString(productName, { width: COLS.item.w - 4 });

        doc.font('Helvetica').fontSize(7);
        const metaH = doc.heightOfString(metaText, { width: COLS.item.w - 4 });

        doc.font('Helvetica').fontSize(7.5);
        const sizeH = doc.heightOfString(sizeText, { width: COLS.specs.w - 4 });
        const finishH = doc.heightOfString(finishColorText, { width: COLS.finish.w - 4 });

        const contentH = Math.max(nameH + metaH + 4, sizeH, finishH, 18);
        const rowHeight = contentH + 10; // 5pt top and bottom padding

        // Check page overflow
        if (y + rowHeight > 700) {
          doc.addPage();
          drawHeader();
          y = drawTableHeader(MARGIN + 82);
        }

        // Row background
        const isEven = index % 2 === 0;
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(isEven ? '#FFFFFF' : '#F8FAFC');
        doc.rect(MARGIN, y + rowHeight - 0.5, CONTENT_WIDTH, 0.5).fill('#E2E8F0');

        // Column 1: Index
        doc.fillColor('#64748B').fontSize(7.5).font('Helvetica');
        doc.text((index + 1).toString(), COLS.num.x, y + 5, { width: COLS.num.w, align: 'center' });

        // Column 2: Product Name + SKU / Brand (NO OVERLAP)
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(productName, COLS.item.x, y + 5, { width: COLS.item.w - 4 });

        doc.fillColor('#64748B').fontSize(7).font('Helvetica');
        doc.text(metaText, COLS.item.x, y + 5 + nameH + 2, { width: COLS.item.w - 4 });

        // Column 3: Specs / Size
        doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
        doc.text(sizeText, COLS.specs.x, y + 5, { width: COLS.specs.w - 4 });

        // Column 4: Finish & Color
        doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
        doc.text(finishColorText, COLS.finish.x, y + 5, { width: COLS.finish.w - 4 });

        // Column 5: Quantity
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica');
        doc.text(`${item.quantity} pcs`, COLS.qty.x, y + 5, { width: COLS.qty.w, align: 'right' });

        // Column 6: Unit Price
        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`$${(item.unitPrice || 0).toFixed(2)}`, COLS.price.x, y + 5, { width: COLS.price.w, align: 'right' });

        // Column 7: Total
        const lineTotal = item.totalPrice || (item.quantity * item.unitPrice) || 0;
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(`$${lineTotal.toFixed(2)}`, COLS.total.x, y + 5, { width: COLS.total.w, align: 'right' });

        y += rowHeight;
      });

      // Bottom Section: Summary & Totals
      y += 12;
      const summaryW = 220;
      const notesW = CONTENT_WIDTH - summaryW - 12;

      // Calculate dynamic height for Shipping Instructions box to guarantee zero overlap
      doc.fontSize(7.5).font('Helvetica');
      let calculatedNotesH = 24;
      if (order.shippingMarks) {
        calculatedNotesH += doc.heightOfString(`Carton Marks:\n${order.shippingMarks}`, { width: notesW - 16 }) + 6;
      }
      if (order.specialInstructions || order.customerNotes) {
        const notesText = order.specialInstructions || order.customerNotes;
        calculatedNotesH += doc.heightOfString(`Instructions: ${notesText}`, { width: notesW - 16 }) + 6;
      }

      const bottomBoxHeight = Math.max(calculatedNotesH, 90);

      // Check if bottom boxes fit on current page
      if (y + bottomBoxHeight > 740) {
        doc.addPage();
        drawHeader();
        y = MARGIN + 82;
      }

      // Summary Totals Box (Right Aligned)
      const summaryX = MARGIN + CONTENT_WIDTH - summaryW;
      doc.rect(summaryX, y, summaryW, bottomBoxHeight).fill('#F8FAFC').stroke('#CBD5E1');

      let sumY = y + 8;
      doc.fontSize(8).font('Helvetica').fillColor('#475569');
      doc.text('Total Ordered Quantity:', summaryX + 10, sumY);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${order.totalQuantity || 0} pcs`, summaryX + 130, sumY, { width: 80, align: 'right' });

      sumY += 15;
      doc.font('Helvetica').fillColor('#475569').text('Est. Gross Weight:', summaryX + 10, sumY);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${order.estimatedWeightKg || 0} kg`, summaryX + 130, sumY, { width: 80, align: 'right' });

      sumY += 15;
      doc.font('Helvetica').fillColor('#475569').text('Estimated Cartons:', summaryX + 10, sumY);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${order.estimatedCartons || 0} ctn`, summaryX + 130, sumY, { width: 80, align: 'right' });

      if (order.discountAmount && order.discountAmount > 0) {
        sumY += 15;
        doc.font('Helvetica').fillColor('#059669').text(`Tier Discount (${order.discountPercent || 0}%):`, summaryX + 10, sumY);
        doc.font('Helvetica-Bold').fillColor('#059669').text(`-$${order.discountAmount.toFixed(2)}`, summaryX + 130, sumY, { width: 80, align: 'right' });
      }

      // Divider line
      sumY += 16;
      doc.rect(summaryX + 8, sumY, summaryW - 16, 0.5).fill('#CBD5E1');

      sumY += 6;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0F172A').text(`Grand Total (${incoterm}):`, summaryX + 10, sumY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#D97706').text(`${currency} $${(order.totalAmount || 0).toFixed(2)}`, summaryX + 110, sumY, { width: 100, align: 'right' });

      // Special Instructions / Shipping Marks (Left Box, Strict Sequential Height Advancement)
      doc.rect(MARGIN, y, notesW, bottomBoxHeight).fill('#FEF3C7').stroke('#FDE68A');
      doc.fillColor('#92400E').fontSize(8).font('Helvetica-Bold').text('EXPORT SHIPPING & PACKING INSTRUCTIONS', MARGIN + 10, y + 8);
      
      let noteY = y + 22;
      doc.fontSize(7.5).font('Helvetica').fillColor('#78350F');

      if (order.shippingMarks) {
        const marksTitle = 'Carton Marks:';
        doc.font('Helvetica-Bold').text(marksTitle, MARGIN + 10, noteY);
        noteY += 10;
        doc.font('Helvetica').text(order.shippingMarks, MARGIN + 10, noteY, { width: notesW - 20 });
        const marksHeight = doc.heightOfString(order.shippingMarks, { width: notesW - 20 });
        noteY += marksHeight + 6;
      }

      if (order.specialInstructions || order.customerNotes) {
        const specialText = order.specialInstructions || order.customerNotes;
        doc.font('Helvetica-Bold').text('Special Instructions:', MARGIN + 10, noteY);
        noteY += 10;
        doc.font('Helvetica').text(specialText, MARGIN + 10, noteY, { width: notesW - 20 });
      }

      // Page Numbering and Footer across all pages (Fixed at y=780, with no page break trigger)
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
          `H.A. Overseas (India) — Official Export Purchase Order Sheet   |   Page ${i + 1} of ${range.count}`,
          MARGIN,
          780,
          { align: 'center', width: CONTENT_WIDTH, lineBreak: false }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Generates an official Commercial / GST Export Invoice PDF using the existing PDFKit pipeline.
 * Formatted for international trade compliance, customs documentation, and commercial billing.
 */
export const generateCommercialInvoicePdf = (invoice) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        bufferPages: true,
        autoFirstPage: true,
      });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 515.28

      const currency = invoice.currency || 'USD';
      const currencySymbol = currency === 'INR' ? 'Rs.' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
      const incoterm = invoice.incoterm || 'FOB';
      const docType = invoice.docType || 'commercial_invoice';

      const docTitle =
        docType === 'gst_invoice'
          ? 'TAX INVOICE (GST)'
          : docType === 'proforma_invoice'
          ? 'PROFORMA COMMERCIAL INVOICE'
          : docType === 'standard_invoice'
          ? 'INVOICE'
          : 'COMMERCIAL EXPORT INVOICE';

      // Header helper
      const drawHeader = () => {
        // Dark Navy Header Banner
        doc.rect(MARGIN, MARGIN, CONTENT_WIDTH, 68).fill('#0F172A');
        
        // Gold Brand Accent Bar
        doc.rect(MARGIN, MARGIN + 68, CONTENT_WIDTH, 3).fill('#D97706');

        // Brand Title
        doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('H.A. OVERSEAS', MARGIN + 16, MARGIN + 12);
        doc.fontSize(8.5).font('Helvetica').fillColor('#94A3B8').text(
          'Manufacturers & Exporters of Precision Hand Tools, Grease Guns & Engineering Hardware',
          MARGIN + 16,
          MARGIN + 33
        );
        doc.fontSize(7.5).fillColor('#CBD5E1').text(
          'GSTIN: 03AAAAA0000A1Z5   |   IEC: 0300000000   |   PAN: AAAAA0000A   |   Email: haoverseas1313@gmail.com',
          MARGIN + 16,
          MARGIN + 48
        );

        // Logo
        try {
          const logoPath = path.resolve(process.cwd(), 'src/assets/logo.jpg');
          if (fs.existsSync(logoPath)) {
            doc.rect(MARGIN + CONTENT_WIDTH - 64, MARGIN + 9, 50, 50).fill('#FFFFFF');
            doc.image(logoPath, MARGIN + CONTENT_WIDTH - 62, MARGIN + 11, { fit: [46, 46], align: 'center', valign: 'center' });
          }
        } catch (e) {
          // fallback gracefully
        }
      };

      drawHeader();

      // Top Section: Invoice Meta & Consignee Details
      let y = MARGIN + 82;
      const colWidth = (CONTENT_WIDTH - 15) / 2;

      // 1. Invoice Meta Card (Left)
      doc.rect(MARGIN, y, colWidth, 98).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text(docTitle, MARGIN + 12, y + 10);

      doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
      doc.text('Invoice #:', MARGIN + 12, y + 26);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(invoice.invoiceNumber || 'N/A', MARGIN + 85, y + 26);

      doc.font('Helvetica').fillColor('#475569').text('Date & Terms:', MARGIN + 12, y + 40);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(
        `${new Date(invoice.invoiceDate || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} (${incoterm})`,
        MARGIN + 85,
        y + 40
      );

      doc.font('Helvetica').fillColor('#475569').text('Due Date:', MARGIN + 12, y + 54);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(
        invoice.dueDate
          ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : 'Due on Receipt',
        MARGIN + 85,
        y + 54
      );

      doc.font('Helvetica').fillColor('#475569').text('Status:', MARGIN + 12, y + 68);
      const statusColor = invoice.status === 'paid' ? '#059669' : invoice.status === 'void' ? '#DC2626' : '#D97706';
      doc.font('Helvetica-Bold').fillColor(statusColor).text((invoice.status || 'DRAFT').toUpperCase(), MARGIN + 85, y + 68);

      if (invoice.order) {
        doc.font('Helvetica').fillColor('#475569').text('Order Ref:', MARGIN + 12, y + 82);
        doc.font('Helvetica').fillColor('#2563EB').text(String(invoice.order), MARGIN + 85, y + 82, { width: colWidth - 90, ellipsis: true });
      }

      // 2. Consignee Details Card (Right)
      const rightX = MARGIN + colWidth + 15;
      doc.rect(rightX, y, colWidth, 98).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text('CONSIGNEE / BUYER (BILL TO)', rightX + 12, y + 10);

      const cust = invoice.customerDetails || {};
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
      doc.text(`Buyer: ${cust.customerName || 'Export Buyer'}`, rightX + 12, y + 26);
      doc.font('Helvetica-Bold').text(`Company: ${cust.businessName || 'International Consignee'}`, rightX + 12, y + 40);
      doc.font('Helvetica').text(`Country: ${cust.country || 'N/A'} | Phone: ${cust.phoneNumber || 'N/A'}`, rightX + 12, y + 54);
      if (cust.taxId) {
        doc.text(`Tax ID / VAT: ${cust.taxId}`, rightX + 12, y + 68);
      }
      doc.fontSize(7.5).fillColor('#64748B').text(
        `Address: ${cust.address || 'Export Destination Port'}`,
        rightX + 12,
        y + (cust.taxId ? 80 : 68),
        { width: colWidth - 24, lineBreak: false, ellipsis: true }
      );

      y += 112;

      // Table Column Specifications for Invoices
      const COLS = {
        num: { x: MARGIN, w: 22, align: 'center' },
        item: { x: MARGIN + 24, w: 180, align: 'left' },
        hsn: { x: MARGIN + 206, w: 60, align: 'center' },
        qty: { x: MARGIN + 268, w: 55, align: 'right' },
        price: { x: MARGIN + 325, w: 55, align: 'right' },
        disc: { x: MARGIN + 382, w: 45, align: 'right' },
        total: { x: MARGIN + 430, w: 85, align: 'right' },
      };

      const drawTableHeader = (curY) => {
        doc.rect(MARGIN, curY, CONTENT_WIDTH, 22).fill('#1E293B');
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        doc.text('#', COLS.num.x, curY + 6, { width: COLS.num.w, align: 'center' });
        doc.text('DESCRIPTION / SKU', COLS.item.x, curY + 6, { width: COLS.item.w });
        doc.text('HSN/SAC', COLS.hsn.x, curY + 6, { width: COLS.hsn.w, align: 'center' });
        doc.text('QTY', COLS.qty.x, curY + 6, { width: COLS.qty.w, align: 'right' });
        doc.text('UNIT PRICE', COLS.price.x, curY + 6, { width: COLS.price.w, align: 'right' });
        doc.text('DISC %', COLS.disc.x, curY + 6, { width: COLS.disc.w, align: 'right' });
        doc.text(`TOTAL (${currency})`, COLS.total.x, curY + 6, { width: COLS.total.w, align: 'right' });
        return curY + 24;
      };

      y = drawTableHeader(y);

      // Render Items with dynamic height
      const items = Array.isArray(invoice.items) && invoice.items.length > 0
        ? invoice.items
        : [{ productName: 'Export Hardware Items', sku: 'GEN', hsnCode: '8205.59', quantity: 1, unit: 'LOT', unitPrice: invoice.grandTotal || 0, lineTotal: invoice.grandTotal || 0 }];

      items.forEach((item, index) => {
        const productName = item.productName || item.description || 'Export Hand Tool';
        const metaParts = [];
        if (item.sku && item.sku !== 'N/A') metaParts.push(`SKU: ${item.sku}`);
        if (item.description && item.description !== productName) metaParts.push(item.description);
        const metaText = metaParts.join(' | ');

        doc.font('Helvetica-Bold').fontSize(8);
        const nameH = doc.heightOfString(productName, { width: COLS.item.w - 4 });

        doc.font('Helvetica').fontSize(7);
        const metaH = metaText ? doc.heightOfString(metaText, { width: COLS.item.w - 4 }) : 0;

        const rowHeight = Math.max(nameH + metaH + 6, 20);

        if (y + rowHeight > 690) {
          doc.addPage();
          drawHeader();
          y = drawTableHeader(MARGIN + 82);
        }

        const isEven = index % 2 === 0;
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(isEven ? '#FFFFFF' : '#F8FAFC');
        doc.rect(MARGIN, y + rowHeight - 0.5, CONTENT_WIDTH, 0.5).fill('#E2E8F0');

        doc.fillColor('#64748B').fontSize(7.5).font('Helvetica');
        doc.text((index + 1).toString(), COLS.num.x, y + 4, { width: COLS.num.w, align: 'center' });

        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(productName, COLS.item.x, y + 4, { width: COLS.item.w - 4 });
        if (metaText) {
          doc.fillColor('#64748B').fontSize(7).font('Helvetica');
          doc.text(metaText, COLS.item.x, y + 4 + nameH + 1, { width: COLS.item.w - 4 });
        }

        doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
        doc.text(item.hsnCode || '8205.59', COLS.hsn.x, y + 4, { width: COLS.hsn.w, align: 'center' });

        doc.fillColor('#0F172A').fontSize(8).font('Helvetica');
        doc.text(`${item.quantity || 1} ${item.unit || 'PCS'}`, COLS.qty.x, y + 4, { width: COLS.qty.w, align: 'right' });

        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`${currencySymbol}${(item.unitPrice || 0).toFixed(2)}`, COLS.price.x, y + 4, { width: COLS.price.w, align: 'right' });

        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`${item.discountPercent || 0}%`, COLS.disc.x, y + 4, { width: COLS.disc.w, align: 'right' });

        const itemTotal = item.lineTotal || (item.quantity * item.unitPrice) || 0;
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(`${currencySymbol}${itemTotal.toFixed(2)}`, COLS.total.x, y + 4, { width: COLS.total.w, align: 'right' });

        y += rowHeight;
      });

      // Bottom Section: Summary & Totals
      y += 12;
      const summaryW = 230;
      const notesW = CONTENT_WIDTH - summaryW - 12;
      const bottomBoxHeight = 135;

      if (y + bottomBoxHeight > 730) {
        doc.addPage();
        drawHeader();
        y = MARGIN + 82;
      }

      // Summary Box (Right)
      const summaryX = MARGIN + CONTENT_WIDTH - summaryW;
      doc.rect(summaryX, y, summaryW, bottomBoxHeight).fill('#F8FAFC').stroke('#CBD5E1');

      let sumY = y + 8;
      doc.fontSize(8).font('Helvetica').fillColor('#475569');
      doc.text('Subtotal:', summaryX + 10, sumY);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${(invoice.subtotal || 0).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });

      if (invoice.discountAmount && invoice.discountAmount > 0) {
        sumY += 14;
        doc.font('Helvetica').fillColor('#059669').text('Discount:', summaryX + 10, sumY);
        doc.font('Helvetica-Bold').fillColor('#059669').text(`-${currencySymbol}${invoice.discountAmount.toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
      }

      if (docType === 'gst_invoice' && invoice.taxAmount > 0) {
        sumY += 14;
        if (invoice.isIgst) {
          doc.font('Helvetica').fillColor('#475569').text('IGST (Integrated Tax):', summaryX + 10, sumY);
          doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${(invoice.igstAmount || invoice.taxAmount).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
        } else {
          doc.font('Helvetica').fillColor('#475569').text('CGST / SGST (Central + State):', summaryX + 10, sumY);
          doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${((invoice.cgstAmount || 0) + (invoice.sgstAmount || 0)).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
        }
      }

      if (invoice.roundOff && invoice.roundOff !== 0) {
        sumY += 14;
        doc.font('Helvetica').fillColor('#64748B').text('Round Off:', summaryX + 10, sumY);
        doc.font('Helvetica').fillColor('#64748B').text(`${invoice.roundOff > 0 ? '+' : ''}${invoice.roundOff.toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
      }

      sumY += 16;
      doc.rect(summaryX + 8, sumY, summaryW - 16, 0.5).fill('#CBD5E1');

      sumY += 6;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0F172A').text(`Grand Total (${incoterm}):`, summaryX + 10, sumY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#D97706').text(`${currency} ${currencySymbol}${(invoice.grandTotal || 0).toFixed(2)}`, summaryX + 90, sumY, { width: 130, align: 'right' });

      sumY += 16;
      doc.fontSize(8).font('Helvetica').fillColor('#475569').text('Amount Paid:', summaryX + 10, sumY);
      doc.font('Helvetica-Bold').fillColor('#059669').text(`${currencySymbol}${(invoice.amountPaid || 0).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });

      sumY += 14;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(invoice.balanceDue > 0 ? '#DC2626' : '#059669').text('Balance Due:', summaryX + 10, sumY);
      doc.font('Helvetica-Bold').fillColor(invoice.balanceDue > 0 ? '#DC2626' : '#059669').text(
        `${currencySymbol}${Math.max(0, invoice.balanceDue ?? (invoice.grandTotal - (invoice.amountPaid || 0))).toFixed(2)}`,
        summaryX + 110,
        sumY,
        { width: 110, align: 'right' }
      );

      // Left Box: Amount in words & Export Declarations
      doc.rect(MARGIN, y, notesW, bottomBoxHeight).fill('#F8FAFC').stroke('#CBD5E1');
      doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold').text('AMOUNT IN WORDS', MARGIN + 10, y + 8);
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155').text(
        invoice.totalInWords || `${currency} ${(invoice.grandTotal || 0).toFixed(2)} Only`,
        MARGIN + 10,
        y + 20,
        { width: notesW - 20 }
      );

      let declY = y + 44;
      doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold').text('BANK & STATUTORY DECLARATION', MARGIN + 10, declY);
      declY += 12;
      doc.font('Helvetica').fontSize(7).fillColor('#64748B').text(
        invoice.exportHeaderNote || 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX UNDER LUT',
        MARGIN + 10,
        declY,
        { width: notesW - 20 }
      );
      declY += 12;
      doc.text(
        invoice.exportDeclaration || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
        MARGIN + 10,
        declY,
        { width: notesW - 20 }
      );
      declY += 16;
      doc.font('Helvetica-Bold').fillColor('#0F172A').text('For H.A. OVERSEAS — Authorized Signatory', MARGIN + 10, declY);

      // Page numbering across pages
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
          `H.A. Overseas (India) — Commercial Export Invoice   |   Page ${i + 1} of ${range.count}`,
          MARGIN,
          780,
          { align: 'center', width: CONTENT_WIDTH, lineBreak: false }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

