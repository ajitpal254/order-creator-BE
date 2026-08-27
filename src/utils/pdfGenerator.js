import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export const generateOrderPdf = (order) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const PAGE_WIDTH = 595.28;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 515.28

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
      let y = MARGIN + 85;

      // 1. Order Info Card (Left)
      const colWidth = (CONTENT_WIDTH - 15) / 2;
      doc.rect(MARGIN, y, colWidth, 90).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold').text('ORDER CONFIRMATION', MARGIN + 12, y + 10);
      
      doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
      doc.text('Order Number:', MARGIN + 12, y + 28);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(order.orderNumber || 'N/A', MARGIN + 85, y + 28);

      doc.font('Helvetica').fillColor('#475569').text('PO Reference:', MARGIN + 12, y + 42);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(order.poNumber || 'N/A', MARGIN + 85, y + 42);

      doc.font('Helvetica').fillColor('#475569').text('Order Date:', MARGIN + 12, y + 56);
      doc.font('Helvetica').fillColor('#0F172A').text(
        new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        MARGIN + 85,
        y + 56
      );

      doc.font('Helvetica').fillColor('#475569').text('Status:', MARGIN + 12, y + 70);
      doc.font('Helvetica-Bold').fillColor('#D97706').text((order.status || 'SUBMITTED').toUpperCase(), MARGIN + 85, y + 70);

      // 2. Buyer Details Card (Right)
      const rightX = MARGIN + colWidth + 15;
      doc.rect(rightX, y, colWidth, 90).fill('#F8FAFC').stroke('#E2E8F0');
      doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold').text('BUYER / CONSIGNEE', rightX + 12, y + 10);

      doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
      const cust = order.customerDetails || {};
      doc.text(`Contact: ${cust.customerName || 'N/A'}`, rightX + 12, y + 28);
      doc.font('Helvetica-Bold').text(`Company: ${cust.businessName || 'N/A'}`, rightX + 12, y + 42);
      doc.font('Helvetica').text(`Country: ${cust.country || 'N/A'} | Phone: ${cust.phoneNumber || 'N/A'}`, rightX + 12, y + 56);
      doc.fontSize(7.5).fillColor('#64748B').text(`Address: ${cust.address || 'N/A'}`, rightX + 12, y + 70, { width: colWidth - 24, lineBreak: false, ellipsis: true });

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
        if (item.customMarking) metaParts.push(`Marking: ${item.customMarking}`);
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

        const contentH = Math.max(nameH + metaH + 4, sizeH, finishH, 20);
        const rowHeight = contentH + 12; // 6pt padding top and bottom

        // Check page overflow
        if (y + rowHeight > 740) {
          doc.addPage();
          drawHeader();
          y = drawTableHeader(MARGIN + 85);
        }

        // Row background
        const isEven = index % 2 === 0;
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(isEven ? '#FFFFFF' : '#F8FAFC');
        doc.rect(MARGIN, y + rowHeight - 0.5, CONTENT_WIDTH, 0.5).fill('#E2E8F0');

        // Column 1: Index
        doc.fillColor('#64748B').fontSize(7.5).font('Helvetica');
        doc.text((index + 1).toString(), COLS.num.x, y + 6, { width: COLS.num.w, align: 'center' });

        // Column 2: Product Name + SKU / Brand (Stacked sequentially, NO OVERLAP)
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(productName, COLS.item.x, y + 6, { width: COLS.item.w - 4 });

        doc.fillColor('#64748B').fontSize(7).font('Helvetica');
        doc.text(metaText, COLS.item.x, y + 6 + nameH + 2, { width: COLS.item.w - 4 });

        // Column 3: Specs / Size
        doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
        doc.text(sizeText, COLS.specs.x, y + 6, { width: COLS.specs.w - 4 });

        // Column 4: Finish & Color
        doc.fillColor('#334155').fontSize(7.5).font('Helvetica');
        doc.text(finishColorText, COLS.finish.x, y + 6, { width: COLS.finish.w - 4 });

        // Column 5: Quantity
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica');
        doc.text(`${item.quantity} pcs`, COLS.qty.x, y + 6, { width: COLS.qty.w, align: 'right' });

        // Column 6: Unit Price
        doc.fillColor('#475569').fontSize(8).font('Helvetica');
        doc.text(`$${(item.unitPrice || 0).toFixed(2)}`, COLS.price.x, y + 6, { width: COLS.price.w, align: 'right' });

        // Column 7: Total
        const lineTotal = item.totalPrice || (item.quantity * item.unitPrice) || 0;
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(`$${lineTotal.toFixed(2)}`, COLS.total.x, y + 6, { width: COLS.total.w, align: 'right' });

        y += rowHeight;
      });

      // Bottom Section: Summary & Totals
      y += 12;
      if (y + 110 > 750) {
        doc.addPage();
        drawHeader();
        y = MARGIN + 85;
      }

      // Summary Totals Box (Right Aligned)
      const summaryW = 230;
      const summaryX = MARGIN + CONTENT_WIDTH - summaryW;

      doc.rect(summaryX, y, summaryW, 78).fill('#F8FAFC').stroke('#CBD5E1');

      doc.fontSize(8).font('Helvetica').fillColor('#475569');
      doc.text('Total Ordered Quantity:', summaryX + 12, y + 10);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${order.totalQuantity || 0} pcs`, summaryX + 140, y + 10, { width: 78, align: 'right' });

      doc.font('Helvetica').fillColor('#475569').text('Est. Gross Weight:', summaryX + 12, y + 24);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${order.estimatedWeightKg || 0} kg`, summaryX + 140, y + 24, { width: 78, align: 'right' });

      doc.font('Helvetica').fillColor('#475569').text('Estimated Cartons:', summaryX + 12, y + 38);
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`${order.estimatedCartons || 0} ctn`, summaryX + 140, y + 38, { width: 78, align: 'right' });

      // Divider line
      doc.rect(summaryX + 10, y + 52, summaryW - 20, 0.5).fill('#CBD5E1');

      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0F172A').text('Grand Total (FOB):', summaryX + 12, y + 58);
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#D97706').text(`$${(order.totalAmount || 0).toFixed(2)} USD`, summaryX + 120, y + 57, { width: 98, align: 'right' });

      // Special Instructions / Shipping Marks (Left side of Summary)
      if (order.shippingMarks || order.customerNotes || order.specialInstructions) {
        const notesW = CONTENT_WIDTH - summaryW - 15;
        doc.rect(MARGIN, y, notesW, 78).fill('#FEF3C7').stroke('#FDE68A');
        doc.fillColor('#92400E').fontSize(8.5).font('Helvetica-Bold').text('EXPORT SHIPPING & PACKING INSTRUCTIONS', MARGIN + 10, y + 8);
        
        doc.fontSize(7.5).font('Helvetica').fillColor('#78350F');
        let noteY = y + 22;
        if (order.shippingMarks) {
          doc.text(`Master Carton Marks: ${order.shippingMarks}`, MARGIN + 10, noteY, { width: notesW - 20 });
          noteY += 16;
        }
        if (order.customerNotes || order.specialInstructions) {
          doc.text(`Notes: ${order.customerNotes || order.specialInstructions}`, MARGIN + 10, noteY, { width: notesW - 20, lineBreak: false, ellipsis: true });
        }
      }

      // Page Numbering and Footer across all pages
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
          `H.A. Overseas (India) — Official Export Purchase Order Sheet   |   Page ${i + 1} of ${totalPages}`,
          MARGIN,
          800,
          { align: 'center', width: CONTENT_WIDTH }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
