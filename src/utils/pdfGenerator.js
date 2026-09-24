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

      const sender = invoice.senderDetails || {};
      const companyName = (sender.companyName && sender.companyName.trim() !== '') ? sender.companyName.trim() : 'H.A. OVERSEAS';
      const companySubtitle = (sender.companyName && sender.companyName.trim() !== '')
        ? (sender.address ? sender.address.replace(/\r?\n/g, ', ') : 'Commercial Invoicing & Trade Billing')
        : 'Manufacturers & Exporters of Precision Hand Tools, Grease Guns & Engineering Hardware';
      const companyMeta = sender.gstin
        ? `Tax / GST ID: ${sender.gstin}   |   Email: ${sender.email || 'billing@haoverseas.com'}   |   Phone: ${sender.phoneNumber || sender.phone || '+1-000-000-0000'}`
        : 'GSTIN: 03AAAAA0000A1Z5   |   IEC: 0300000000   |   PAN: AAAAA0000A   |   Email: haoverseas1313@gmail.com';

      const isHaBrand = companyName.toUpperCase().includes('H.A.') || companyName.toUpperCase().includes('OVERSEAS');

      // If standard invoice, use clean modern minimalist layout matching standard invoice format
      if (docType === 'standard_invoice') {
        renderStandardInvoice(doc, invoice, {
          PAGE_WIDTH,
          PAGE_HEIGHT,
          MARGIN,
          CONTENT_WIDTH,
          currency,
          currencySymbol,
          sender,
          companyName,
        });
        doc.end();
        return;
      }

      // Header helper for Commercial / GST / Export
      const drawHeader = () => {
        // Dark Navy Header Banner
        doc.rect(MARGIN, MARGIN, CONTENT_WIDTH, 70).fill('#0F172A');
        
        // Gold Brand Accent Bar
        doc.rect(MARGIN, MARGIN + 70, CONTENT_WIDTH, 3).fill('#D97706');

        // Brand Title
        doc.fillColor('#FFFFFF').fontSize(15).font('Helvetica-Bold').text(companyName.toUpperCase(), MARGIN + 16, MARGIN + 11, { width: CONTENT_WIDTH - 85, ellipsis: true });
        doc.fontSize(8).font('Helvetica').fillColor('#94A3B8').text(
          companySubtitle,
          MARGIN + 16,
          MARGIN + 31,
          { width: CONTENT_WIDTH - 85, ellipsis: true }
        );
        doc.fontSize(7.5).font('Helvetica').fillColor('#CBD5E1').text(
          companyMeta,
          MARGIN + 16,
          MARGIN + 48,
          { width: CONTENT_WIDTH - 85, ellipsis: true }
        );

        // Logo or Custom Brand Monogram Badge
        try {
          if (isHaBrand) {
            const logoPath = path.resolve(process.cwd(), 'src/assets/logo.jpg');
            if (fs.existsSync(logoPath)) {
              doc.rect(MARGIN + CONTENT_WIDTH - 64, MARGIN + 10, 50, 50).fill('#FFFFFF');
              doc.image(logoPath, MARGIN + CONTENT_WIDTH - 62, MARGIN + 12, { fit: [46, 46], align: 'center', valign: 'center' });
            }
          } else {
            // Elegant Issuer Monogram Badge for custom businesses
            const badgeX = MARGIN + CONTENT_WIDTH - 64;
            const badgeY = MARGIN + 10;
            doc.rect(badgeX, badgeY, 50, 50).fill('#1E293B').stroke('#D97706');
            const initials = companyName
              .split(' ')
              .map((w) => w[0])
              .filter(Boolean)
              .slice(0, 3)
              .join('');
            doc.fillColor('#F59E0B').fontSize(14).font('Helvetica-Bold').text(initials || 'INC', badgeX, badgeY + 16, { width: 50, align: 'center' });
          }
        } catch (e) {
          // fallback gracefully
        }
      };

      drawHeader();

      // Top Section: Invoice Meta & Consignee Details
      let y = MARGIN + 84;
      const colWidth = (CONTENT_WIDTH - 15) / 2;
      const cardHeight = 112;

      // 1. Invoice Meta Card (Left)
      doc.rect(MARGIN, y, colWidth, cardHeight).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text(docTitle, MARGIN + 12, y + 10);

      doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
      doc.text('Invoice #:', MARGIN + 12, y + 26);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(invoice.invoiceNumber || 'N/A', MARGIN + 85, y + 26);

      const formattedDate = new Date(invoice.invoiceDate || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      
      doc.font('Helvetica').fillColor('#475569').text('Date & Terms:', MARGIN + 12, y + 42);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(
        `${formattedDate} (${incoterm})`,
        MARGIN + 85,
        y + 42
      );

      doc.font('Helvetica').fillColor('#475569').text('Due Date:', MARGIN + 12, y + 58);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(
        invoice.dueDate
          ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : 'Due on Receipt',
        MARGIN + 85,
        y + 58
      );

      doc.font('Helvetica').fillColor('#475569').text('Status:', MARGIN + 12, y + 74);
      const statusColor = invoice.status === 'paid' ? '#059669' : invoice.status === 'void' ? '#DC2626' : '#D97706';
      doc.font('Helvetica-Bold').fillColor(statusColor).text((invoice.status || 'DRAFT').toUpperCase(), MARGIN + 85, y + 74);

      if (invoice.order) {
        doc.font('Helvetica').fillColor('#475569').text('Order Ref:', MARGIN + 12, y + 90);
        doc.font('Helvetica').fillColor('#2563EB').text(String(invoice.order), MARGIN + 85, y + 90, { width: colWidth - 95, ellipsis: true });
      }

      // 2. Consignee Details Card (Right) - Sequential Layout with No Overlap
      const rightX = MARGIN + colWidth + 15;
      doc.rect(rightX, y, colWidth, cardHeight).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text('CONSIGNEE / BUYER (BILL TO)', rightX + 12, y + 10);

      const cust = invoice.customerDetails || {};
      let buyerY = y + 26;
      const bName = (cust.businessName || cust.customerName || 'Direct Client').trim();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0F172A').text(bName, rightX + 12, buyerY, { width: colWidth - 24 });
      buyerY += doc.heightOfString(bName, { width: colWidth - 24 }) + 4;

      if (cust.customerName && cust.customerName.trim() !== bName) {
        doc.font('Helvetica').fontSize(8).fillColor('#334155').text(`Attn: ${cust.customerName.trim()}`, rightX + 12, buyerY, { width: colWidth - 24 });
        buyerY += doc.heightOfString(`Attn: ${cust.customerName.trim()}`, { width: colWidth - 24 }) + 3;
      }

      if (cust.address && cust.address.trim() !== bName) {
        const cleanAddr = cust.address.replace(/\r?\n/g, ', ').trim();
        doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(cleanAddr, rightX + 12, buyerY, { width: colWidth - 24 });
        buyerY += doc.heightOfString(cleanAddr, { width: colWidth - 24 }) + 3;
      }

      const locParts = [cust.country, cust.phoneNumber].filter(Boolean).join('   |   ');
      if (locParts) {
        doc.font('Helvetica').fontSize(7.5).fillColor('#64748B').text(locParts, rightX + 12, buyerY, { width: colWidth - 24 });
        buyerY += doc.heightOfString(locParts, { width: colWidth - 24 }) + 3;
      }

      if (cust.taxId) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748B').text(`Tax / BN ID: ${cust.taxId}`, rightX + 12, buyerY, { width: colWidth - 24 });
      }

      y += cardHeight + 12;

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

      // Render Items with clean single-line title or clean SKU without stale description
      const items = Array.isArray(invoice.items) && invoice.items.length > 0
        ? invoice.items
        : [{ productName: 'Export Hardware Items', sku: 'GEN', hsnCode: '8205.59', quantity: 1, unit: 'LOT', unitPrice: invoice.grandTotal || 0, lineTotal: invoice.grandTotal || 0 }];

      items.forEach((item, index) => {
        const productName = (item.productName || item.description || 'Export Hand Tool').trim();
        const skuText = (item.sku && item.sku !== 'N/A') ? `SKU: ${item.sku.trim()}` : '';

        doc.font('Helvetica-Bold').fontSize(8);
        const nameH = doc.heightOfString(productName, { width: COLS.item.w - 4 });

        doc.font('Helvetica').fontSize(7);
        const skuH = skuText ? doc.heightOfString(skuText, { width: COLS.item.w - 4 }) : 0;

        const rowHeight = Math.max(nameH + skuH + 8, 22);

        if (y + rowHeight > 690) {
          doc.addPage();
          drawHeader();
          y = drawTableHeader(MARGIN + 84);
        }

        const isEven = index % 2 === 0;
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(isEven ? '#FFFFFF' : '#F8FAFC');
        doc.rect(MARGIN, y + rowHeight - 0.5, CONTENT_WIDTH, 0.5).fill('#E2E8F0');

        doc.fillColor('#64748B').fontSize(7.5).font('Helvetica');
        doc.text((index + 1).toString(), COLS.num.x, y + 5, { width: COLS.num.w, align: 'center' });

        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(productName, COLS.item.x, y + 5, { width: COLS.item.w - 4 });
        if (skuText) {
          doc.fillColor('#64748B').fontSize(7).font('Helvetica');
          doc.text(skuText, COLS.item.x, y + 5 + nameH + 1, { width: COLS.item.w - 4 });
        }

        doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
        doc.text(item.hsnCode || '8205.59', COLS.hsn.x, y + 5, { width: COLS.hsn.w, align: 'center' });

        doc.fillColor('#0F172A').fontSize(8).font('Helvetica');
        doc.text(`${item.quantity || 1} ${item.unit || 'PCS'}`, COLS.qty.x, y + 5, { width: COLS.qty.w, align: 'right' });

        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`${currencySymbol}${(item.unitPrice || 0).toFixed(2)}`, COLS.price.x, y + 5, { width: COLS.price.w, align: 'right' });

        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`${item.discountPercent || 0}%`, COLS.disc.x, y + 5, { width: COLS.disc.w, align: 'right' });

        const itemTotal = item.lineTotal || (item.quantity * item.unitPrice) || 0;
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(`${currencySymbol}${itemTotal.toFixed(2)}`, COLS.total.x, y + 5, { width: COLS.total.w, align: 'right' });

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
        y = MARGIN + 84;
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

      if (invoice.shippingCharges && invoice.shippingCharges > 0) {
        sumY += 14;
        doc.font('Helvetica').fillColor('#475569').text('Freight / Shipping:', summaryX + 10, sumY);
        doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${(invoice.shippingCharges || 0).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
      }

      if (invoice.taxAmount && invoice.taxAmount > 0) {
        sumY += 14;
        if (docType === 'gst_invoice') {
          if (invoice.isIgst) {
            doc.font('Helvetica').fillColor('#475569').text('IGST (Integrated Tax):', summaryX + 10, sumY);
            doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${(invoice.igstAmount || invoice.taxAmount).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
          } else {
            doc.font('Helvetica').fillColor('#475569').text('CGST / SGST:', summaryX + 10, sumY);
            doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${((invoice.cgstAmount || 0) + (invoice.sgstAmount || 0)).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
          }
        } else {
          doc.font('Helvetica').fillColor('#475569').text(`Tax (${invoice.taxRate || 0}%):`, summaryX + 10, sumY);
          doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${currencySymbol}${(invoice.taxAmount || 0).toFixed(2)}`, summaryX + 110, sumY, { width: 110, align: 'right' });
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

      // Left Box: Amount in words & Declarations
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
      
      const declLine1 = invoice.exportHeaderNote || 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX UNDER LUT';
      
      doc.font('Helvetica').fontSize(7).fillColor('#64748B').text(
        declLine1,
        MARGIN + 10,
        declY,
        { width: notesW - 20 }
      );
      declY += 14;

      const declLine2 = invoice.exportDeclaration || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';

      doc.text(
        declLine2,
        MARGIN + 10,
        declY,
        { width: notesW - 20 }
      );
      declY += 16;
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`For ${companyName.toUpperCase()} — Authorized Signatory`, MARGIN + 10, declY);

      // Page numbering across pages
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
          `${companyName} — Official Invoice   |   Page ${i + 1} of ${range.count}`,
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
 * Standard Normal Invoice layout matching modern clean business billing format
 */
function renderStandardInvoice(doc, invoice, ctx) {
  const { MARGIN, CONTENT_WIDTH, currencySymbol, sender, companyName } = ctx;
  const green = '#059669';

  // 1. Header
  // Top Left: Company Name (Large bold) + Tax ID
  doc.fillColor('#000000').fontSize(18).font('Helvetica-Bold').text(companyName, MARGIN, MARGIN, { lineBreak: false });
  
  const taxId = sender.gstin || sender.taxId || '';
  if (taxId) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#1E293B').text(`TAX ID: ${taxId}`, MARGIN, MARGIN + 25);
  }

  // Top Right: INVOICE (Large green) + # Invoice Number
  doc.fillColor(green).fontSize(22).font('Helvetica-Bold').text('INVOICE', MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0F172A').text(`# ${invoice.invoiceNumber || 'INV-0001'}`, MARGIN, MARGIN + 27, { width: CONTENT_WIDTH, align: 'right' });

  // 2. FROM and BILL TO Columns (Clean, spacious, sequential line heights)
  let y = MARGIN + 58;
  const colW = (CONTENT_WIDTH - 30) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 30;

  // FROM column
  doc.fillColor('#475569').fontSize(8.5).font('Helvetica-Bold').text('FROM', leftX, y);
  let fromY = y + 15;

  doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(companyName, leftX, fromY, { width: colW });
  fromY += doc.heightOfString(companyName, { width: colW }) + 3;

  if (sender.address) {
    const sAddr = sender.address.replace(/\r?\n/g, '\n').trim();
    doc.fillColor('#334155').fontSize(8.5).font('Helvetica').text(sAddr, leftX, fromY, { width: colW });
    fromY += doc.heightOfString(sAddr, { width: colW }) + 3;
  }
  const sContact = [sender.email, sender.phoneNumber].filter(Boolean).join(' | ');
  if (sContact) {
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text(sContact, leftX, fromY, { width: colW });
    fromY += doc.heightOfString(sContact, { width: colW }) + 3;
  }

  // BILL TO column
  doc.fillColor('#475569').fontSize(8.5).font('Helvetica-Bold').text('BILL TO', rightX, y);
  let billY = y + 15;

  const cust = invoice.customerDetails || {};
  const bName = (cust.businessName || cust.customerName || 'Direct Client').trim();
  doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(bName, rightX, billY, { width: colW });
  billY += doc.heightOfString(bName, { width: colW }) + 3;

  if (cust.customerName && cust.businessName && cust.customerName.trim() !== cust.businessName.trim()) {
    doc.fillColor('#334155').fontSize(8.5).font('Helvetica').text(`Attn: ${cust.customerName.trim()}`, rightX, billY, { width: colW });
    billY += doc.heightOfString(`Attn: ${cust.customerName.trim()}`, { width: colW }) + 3;
  }

  if (cust.address) {
    const cAddr = cust.address.replace(/\r?\n/g, '\n').trim();
    doc.fillColor('#334155').fontSize(8.5).font('Helvetica').text(cAddr, rightX, billY, { width: colW });
    billY += doc.heightOfString(cAddr, { width: colW }) + 3;
  }

  const cContact = [cust.country, cust.phoneNumber].filter(Boolean).join(' | ');
  if (cContact) {
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text(cContact, rightX, billY, { width: colW });
    billY += doc.heightOfString(cContact, { width: colW }) + 3;
  }

  y = Math.max(fromY, billY) + 16;

  // 3. Issue Date / Due Date
  const rawDate = invoice.invoiceDate || invoice.createdAt || Date.now();
  const formattedDate = new Date(rawDate).toLocaleDateString('en-CA'); // YYYY-MM-DD
  
  doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold').text('Issue Date:  ', leftX, y, { continued: true });
  doc.font('Helvetica').text(formattedDate, { continued: invoice.dueDate ? true : false });
  if (invoice.dueDate) {
    const formattedDueDate = new Date(invoice.dueDate).toLocaleDateString('en-CA');
    doc.font('Helvetica-Bold').text('      Due Date:  ', { continued: true });
    doc.font('Helvetica').text(formattedDueDate);
  }
  y += 24;

  // 4. Line Items Table (Description, Hrs/Qty, Price, Total)
  const isHrs = (invoice.items || []).some(
    (it) => it.unit === 'HRS' || (it.productName && it.productName.toLowerCase().includes('project')) || (it.productName && it.productName.toLowerCase().includes('hr'))
  );
  const qtyTitle = isHrs ? 'Hrs' : 'Qty';

  const STD_COLS = {
    desc: { x: MARGIN, w: 295, align: 'left' },
    qty: { x: MARGIN + 300, w: 50, align: 'right' },
    price: { x: MARGIN + 360, w: 65, align: 'right' },
    total: { x: MARGIN + 435, w: 80, align: 'right' },
  };

  // Header row
  doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
  doc.text('Description', STD_COLS.desc.x, y, { width: STD_COLS.desc.w });
  doc.text(qtyTitle, STD_COLS.qty.x, y, { width: STD_COLS.qty.w, align: 'right' });
  doc.text('Price', STD_COLS.price.x, y, { width: STD_COLS.price.w, align: 'right' });
  doc.text('Total', STD_COLS.total.x, y, { width: STD_COLS.total.w, align: 'right' });
  y += 14;

  // Divider line
  doc.rect(MARGIN, y, CONTENT_WIDTH, 1).fill('#E2E8F0');
  y += 10;

  const items = Array.isArray(invoice.items) && invoice.items.length > 0
    ? invoice.items
    : [{ productName: 'Professional Services', quantity: 1, unitPrice: invoice.grandTotal || 0, lineTotal: invoice.grandTotal || 0 }];

  items.forEach((item) => {
    const desc = (item.productName || item.description || 'Service').trim();
    doc.font('Helvetica').fontSize(8.5);
    const descH = doc.heightOfString(desc, { width: STD_COLS.desc.w });
    const rowH = Math.max(descH + 6, 20);

    doc.fillColor('#0F172A').font('Helvetica').fontSize(8.5);
    doc.text(desc, STD_COLS.desc.x, y, { width: STD_COLS.desc.w });

    const qtyText = `${item.quantity || 1}`;
    doc.text(qtyText, STD_COLS.qty.x, y, { width: STD_COLS.qty.w, align: 'right' });

    const priceText = `${currencySymbol}${(item.unitPrice || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    doc.text(priceText, STD_COLS.price.x, y, { width: STD_COLS.price.w, align: 'right' });

    const lineTotal = item.lineTotal || (item.quantity * item.unitPrice) || 0;
    doc.font('Helvetica-Bold').text(
      `${currencySymbol}${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      STD_COLS.total.x,
      y,
      { width: STD_COLS.total.w, align: 'right' }
    );

    y += rowH;
  });

  y += 14;

  // 5. Totals Section (Right Aligned)
  const sumLabelW = 90;
  const sumValW = 100;
  const sumRightX = MARGIN + CONTENT_WIDTH - sumValW;
  const sumLabelX = sumRightX - sumLabelW - 10;

  // Subtotal
  doc.fillColor('#475569').fontSize(8.5).font('Helvetica').text('Subtotal', sumLabelX, y, { width: sumLabelW, align: 'right' });
  doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica').text(
    `${currencySymbol}${(invoice.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    sumRightX,
    y,
    { width: sumValW, align: 'right' }
  );
  y += 18;

  // Tax
  if (invoice.taxAmount && invoice.taxAmount > 0) {
    const taxRate = invoice.taxRate || 13;
    doc.fillColor('#475569').fontSize(8.5).font('Helvetica').text(`Tax (${taxRate}%)`, sumLabelX, y, { width: sumLabelW, align: 'right' });
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica').text(
      `${currencySymbol}${(invoice.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sumRightX,
      y,
      { width: sumValW, align: 'right' }
    );
    y += 18;
  }

  // Total (Large Green)
  y += 4;
  doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Total', sumLabelX, y + 2, { width: sumLabelW, align: 'right' });
  doc.fillColor(green).fontSize(16).font('Helvetica-Bold').text(
    `${currencySymbol}${(invoice.grandTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    sumRightX,
    y,
    { width: sumValW, align: 'right' }
  );
  y += 36;

  // 6. Notes & Payment Instructions (Two clean bottom columns)
  const botColW = (CONTENT_WIDTH - 30) / 2;
  const botLeftX = MARGIN;
  const botRightX = MARGIN + botColW + 30;

  // NOTES (Left)
  if (invoice.notes || invoice.customerNotes) {
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold').text('NOTES', botLeftX, y);
    const nText = (invoice.notes || invoice.customerNotes || '').trim();
    doc.fillColor('#334155').fontSize(8).font('Helvetica').text(nText, botLeftX, y + 14, { width: botColW });
  }

  // PAYMENT INSTRUCTIONS (Right)
  const pInstructions = invoice.paymentInstructions || invoice.termsAndConditions || '';
  if (pInstructions) {
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold').text('PAYMENT INSTRUCTIONS', botRightX, y);
    doc.fillColor('#334155').fontSize(8).font('Helvetica').text(pInstructions.trim(), botRightX, y + 14, { width: botColW });
  }

  // 7. Footer across all pages
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
      `${companyName}   |   Standard Invoice`,
      MARGIN,
      780,
      { width: CONTENT_WIDTH, align: 'left' }
    );
    doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
      `${i + 1}/${range.count}`,
      MARGIN,
      780,
      { width: CONTENT_WIDTH, align: 'right' }
    );
  }
}

