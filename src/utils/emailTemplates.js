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

export const EMAIL_TEMPLATES = {
  order_received: orderReceivedTemplate,
  order_confirmed: orderConfirmedTemplate,
  order_status_changed: orderStatusChangedTemplate,
  order_shipped: orderShippedTemplate,
  quote_ready: quoteReadyTemplate,
  payment_received: paymentReceivedTemplate,
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
