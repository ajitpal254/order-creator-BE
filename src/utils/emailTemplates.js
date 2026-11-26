/**
 * Email templates (FEAT-01, v0.4)
 *
 * Pure renderers for the transactional emails that go through the
 * outbox (src/services/outbox.js). Each template takes a plain payload
 * object and returns { subject, text, html }. Branding matches the
 * existing hand-written emails in src/utils/emailService.js: dark navy
 * header (#0f172a) with the amber (#f59e0b) H.A. OVERSEAS wordmark.
 *
 * Payload fields used (all optional except orderNumber):
 *   orderNumber, customerName, status / newStatus, totalAmount,
 *   currency, totalQuantity, carrier, trackingNumber, trackingUrl,
 *   amount (payment_received)
 */

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (amount, currency = 'USD') => {
  const num = Number(amount);
  if (!Number.isFinite(num)) return null;
  return `$${num.toFixed(2)} ${currency}`;
};

const wrap = (heading, innerHtml) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
      <div style="background-color: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #f59e0b; margin: 0; font-size: 24px;">H.A. OVERSEAS</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 14px;">B2B Export Desk</p>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2>${esc(heading)}</h2>
        ${innerHtml}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">H.A. Overseas — Precision Hand Tools & Hardware Exporter</p>
      </div>
    </div>
  `;

const greeting = (payload) =>
  `<p>Dear ${esc(payload.customerName || 'Valued Buyer')},</p>`;

const orderLine = (payload) =>
  `<p>Order <strong>#${esc(payload.orderNumber)}</strong>${
    payload.status ? ` — current status: <strong>${esc(payload.status)}</strong>` : ''
  }${money(payload.totalAmount, payload.currency) ? ` — total: <strong>${esc(money(payload.totalAmount, payload.currency))}</strong>` : ''}.</p>`;

export const orderReceivedTemplate = (payload = {}) => {
  const subject = `Order Received #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'We have received your order',
    `${greeting(payload)}
     ${orderLine(payload)}
     <p>Our export desk is reviewing your specifications and will confirm production timelines shortly. You can track progress anytime in your My Orders dashboard.</p>`
  );
  const text = `Thank you${payload.customerName ? `, ${payload.customerName}` : ''}. We have received your order #${payload.orderNumber} and our export desk is reviewing it.${money(payload.totalAmount, payload.currency) ? ` Total: ${money(payload.totalAmount, payload.currency)}.` : ''}`;
  return { subject, text, html };
};

export const orderConfirmedTemplate = (payload = {}) => {
  const subject = `Order Confirmed #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'Your order is confirmed',
    `${greeting(payload)}
     ${orderLine({ ...payload, status: payload.status || 'Confirmed' })}
     <p>Your quotation has been approved and converted to a confirmed order. Production planning will begin shortly.</p>`
  );
  const text = `Your order #${payload.orderNumber} has been confirmed.${money(payload.totalAmount, payload.currency) ? ` Total: ${money(payload.totalAmount, payload.currency)}.` : ''}`;
  return { subject, text, html };
};

export const orderStatusChangedTemplate = (payload = {}) => {
  const newStatus = payload.newStatus || payload.status || 'Updated';
  const subject = `Order #${payload.orderNumber} Status Update: ${newStatus}`;
  const html = wrap(
    'Order status changed',
    `${greeting(payload)}
     <p>Your export order <strong>#${esc(payload.orderNumber)}</strong> has been updated to:</p>
     <div style="font-size: 18px; font-weight: bold; color: #0369a1; background: #e0f2fe; padding: 10px 16px; border-radius: 6px; display: inline-block; margin-bottom: 12px;">${esc(newStatus)}</div>
     ${payload.note ? `<p><em>Update note: ${esc(payload.note)}</em></p>` : ''}`
  );
  const text = `Your order #${payload.orderNumber} status has changed to: ${newStatus}.${payload.note ? ` Note: ${payload.note}` : ''}`;
  return { subject, text, html };
};

export const orderShippedTemplate = (payload = {}) => {
  const subject = `Order Shipped #${payload.orderNumber} - H.A. Overseas`;
  const trackingHtml =
    payload.trackingNumber || payload.carrier
      ? `<p style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px;">${
          payload.carrier ? `<strong>Carrier:</strong> ${esc(payload.carrier)}<br/>` : ''
        }${payload.trackingNumber ? `<strong>Tracking Number:</strong> ${esc(payload.trackingNumber)}` : ''}</p>`
      : '';
  const html = wrap(
    'Your order has shipped',
    `${greeting(payload)}
     <p>Good news — your export order <strong>#${esc(payload.orderNumber)}</strong> has shipped.</p>
     ${trackingHtml}`
  );
  const trackingText = payload.trackingNumber
    ? ` Carrier: ${payload.carrier || 'Freight Carrier'}, Tracking Number: ${payload.trackingNumber}.`
    : '';
  const text = `Your order #${payload.orderNumber} has shipped.${trackingText}`;
  return { subject, text, html };
};

export const quoteReadyTemplate = (payload = {}) => {
  const subject = `Your Quote is Ready #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'Your formal quote is ready',
    `${greeting(payload)}
     ${orderLine(payload)}
     <p>Our export desk has issued the formal quote for your request. Please review it in your dashboard and confirm to convert it into a binding order.</p>`
  );
  const text = `Your formal quote for request #${payload.orderNumber} is ready.${money(payload.totalAmount, payload.currency) ? ` Quoted total: ${money(payload.totalAmount, payload.currency)}.` : ''} Please review and confirm in your dashboard.`;
  return { subject, text, html };
};

export const paymentReceivedTemplate = (payload = {}) => {
  const paid = money(payload.amount ?? payload.totalAmount, payload.currency);
  const subject = `Payment Received for Order #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'Payment received',
    `${greeting(payload)}
     <p>We have received payment${paid ? ` of <strong>${esc(paid)}</strong>` : ''} for order <strong>#${esc(payload.orderNumber)}</strong>. Thank you — our export desk will proceed with the next steps on your order.</p>`
  );
  const text = `We have received payment${paid ? ` of ${paid}` : ''} for your order #${payload.orderNumber}. Thank you.`;
  return { subject, text, html };
};

// FEAT-02 (v0.5) quote-workflow templates. Payload extras:
// counterAmount / offeredAmount, message, reason, quoteVersion.
export const counterOfferReceivedTemplate = (payload = {}) => {
  const offered = money(payload.counterAmount ?? payload.offeredAmount, payload.currency);
  const subject = `Counter-Offer Received for Quote #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'Counter-offer received',
    `${greeting(payload)}
     ${orderLine(payload)}
     <p>A counter-offer${offered ? ` of <strong>${esc(offered)}</strong>` : ''} has been recorded for this quote.${payload.message ? ` Message: <em>${esc(payload.message)}</em>` : ''} Our export desk will review it and respond.</p>`
  );
  const text = `A counter-offer${offered ? ` of ${offered}` : ''} has been recorded for quote #${payload.orderNumber}.${payload.message ? ` Message: ${payload.message}` : ''}`;
  return { subject, text, html };
};

export const counterOfferRespondedTemplate = (payload = {}) => {
  const accepted = payload.offerAccepted === true || payload.action === 'accept';
  const offered = money(payload.counterAmount ?? payload.offeredAmount, payload.currency);
  const subject = `Counter-Offer ${accepted ? 'Accepted' : 'Declined'} for Quote #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    accepted ? 'Your counter-offer was accepted' : 'Your counter-offer was declined',
    `${greeting(payload)}
     ${orderLine(payload)}
     <p>Your counter-offer${offered ? ` of <strong>${esc(offered)}</strong>` : ''} for quote <strong>#${esc(payload.orderNumber)}</strong> has been ${accepted ? 'accepted — the quoted total has been revised' : 'declined'}. ${accepted ? 'A revised quote is ready for your review.' : 'The current quoted total remains unchanged.'}</p>`
  );
  const text = `Your counter-offer${offered ? ` of ${offered}` : ''} for quote #${payload.orderNumber} has been ${accepted ? 'accepted; the quoted total has been revised' : 'declined'}.`;
  return { subject, text, html };
};

export const quoteAcceptedTemplate = (payload = {}) => {
  const subject = `Quote Accepted #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'Quote accepted',
    `${greeting(payload)}
     ${orderLine(payload)}
     <p>The quote for request <strong>#${esc(payload.orderNumber)}</strong> has been marked accepted. Our export desk will follow up to convert it into a binding order.</p>`
  );
  const text = `Quote #${payload.orderNumber} has been marked accepted.${money(payload.totalAmount, payload.currency) ? ` Quoted total: ${money(payload.totalAmount, payload.currency)}.` : ''}`;
  return { subject, text, html };
};

export const quoteDeclinedTemplate = (payload = {}) => {
  const subject = `Quote Declined #${payload.orderNumber} - H.A. Overseas`;
  const html = wrap(
    'Quote declined',
    `${greeting(payload)}
     ${orderLine(payload)}
     <p>The quote for request <strong>#${esc(payload.orderNumber)}</strong> has been marked declined.${payload.reason ? ` Reason: <em>${esc(payload.reason)}</em>` : ''}</p>`
  );
  const text = `Quote #${payload.orderNumber} has been marked declined.${payload.reason ? ` Reason: ${payload.reason}` : ''}`;
  return { subject, text, html };
};

// FEAT-16 (v0.7): assistant human-handoff. Payload: customerName,
// customerEmail/email, note, transcript, conversationId.
export const assistantHandoffTemplate = (payload = {}) => {
  const customerEmail = payload.customerEmail || payload.email || '';
  const subject = `Assistant Handoff Request${payload.customerName ? ` from ${payload.customerName}` : ''} - H.A. Overseas`;
  const transcriptText = String(payload.transcript || '');
  const html = wrap(
    'Assistant handoff requested',
    `<p>A customer has asked for a human follow-up from the AI Order Desk Assistant.</p>
     <p><strong>Customer:</strong> ${esc(payload.customerName || 'Unknown')}${customerEmail ? ` (${esc(customerEmail)})` : ''}</p>
     ${payload.note ? `<p><strong>Note:</strong> ${esc(payload.note)}</p>` : ''}
     ${payload.conversationId ? `<p><strong>Conversation:</strong> ${esc(payload.conversationId)}</p>` : ''}
     <p><strong>Transcript:</strong></p>
     <pre style="white-space: pre-wrap; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px;">${esc(transcriptText)}</pre>`
  );
  const text = `A customer has asked for a human follow-up from the AI Order Desk Assistant.\nCustomer: ${payload.customerName || 'Unknown'}${customerEmail ? ` (${customerEmail})` : ''}${payload.note ? `\nNote: ${payload.note}` : ''}\nTranscript:\n${transcriptText}`;
  return { subject, text, html };
};

export const rfqReceivedTemplate = (payload = {}) => {
  const subject = `New RFQ from ${payload.name || payload.customerName || 'Website'} - H.A. Overseas`;
  const itemsText = Array.isArray(payload.items) ? payload.items.map((i) => `${i.productName} x ${i.quantity}`).join(', ') : '';
  const html = wrap('New RFQ received', `<p>A new public RFQ has been submitted.</p><p><strong>Name:</strong> ${esc(payload.name || payload.customerName || '')}</p><p><strong>Email:</strong> ${esc(payload.email || '')}</p>${payload.company ? `<p><strong>Company:</strong> ${esc(payload.company)}</p>` : ''}${payload.message ? `<p><strong>Message:</strong> ${esc(payload.message)}</p>` : ''}${itemsText ? `<p><strong>Items:</strong> ${esc(itemsText)}</p>` : ''}`);
  const text = `New RFQ from ${payload.name || ''} (${payload.email || ''}). ${payload.message || ''} ${itemsText}`;
  return { subject, text, html };
};

export const EMAIL_TEMPLATES = {
  rfq_received: rfqReceivedTemplate,
  order_received: orderReceivedTemplate,
  order_confirmed: orderConfirmedTemplate,
  order_status_changed: orderStatusChangedTemplate,
  order_shipped: orderShippedTemplate,
  quote_ready: quoteReadyTemplate,
  payment_received: paymentReceivedTemplate,
  counter_offer_received: counterOfferReceivedTemplate,
  counter_offer_responded: counterOfferRespondedTemplate,
  quote_accepted: quoteAcceptedTemplate,
  quote_declined: quoteDeclinedTemplate,
  assistantHandoff: assistantHandoffTemplate,
};

/**
 * Render a named template. Throws on an unknown template name so a
 * typo at enqueue time fails loudly (the outbox service catches it).
 */
export const renderEmailTemplate = (template, payload = {}) => {
  const renderer = EMAIL_TEMPLATES[template];
  if (!renderer) throw new Error(`Unknown email template: ${template}`);
  return renderer(payload || {});
};
