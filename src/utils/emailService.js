import nodemailer from 'nodemailer';
import { logger } from './logger.js';

// Setup reusable transporter
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

const sendMail = async ({ to, subject, html, text }) => {
  const mailer = getTransporter();
  const from = process.env.EMAIL_FROM || '"H.A. Overseas Export Desk" <orders@haoverseas.com>';

  if (!mailer) {
    logger.info(`[Email Service (Dev/Staging Simulated)] To: ${to} | Subject: "${subject}"`);
    return { success: true, simulated: true };
  }

  try {
    const info = await mailer.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    logger.info(`Email dispatched to ${to} (MessageID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Failed to send email to ${to}`, { error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Send buyer order submission confirmation
 */
export const sendOrderConfirmationEmail = async ({ order, user }) => {
  const recipient = order.customerDetails?.email || user?.email;
  if (!recipient) return;

  const subject = `Order Confirmation #${order.orderNumber} - H.A. Overseas`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
      <div style="background-color: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: #f59e0b; margin: 0; font-size: 24px;">H.A. OVERSEAS</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 14px;">B2B Export Order Confirmation</p>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2>Thank you for your order, ${order.customerDetails?.customerName || 'Valued Buyer'}!</h2>
        <p>We have successfully received your custom tool specification order <strong>#${order.orderNumber}</strong>. Our export desk is reviewing the configuration details and will confirm production timelines shortly.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Total Items:</strong></td>
            <td style="padding: 10px; border: 1px solid #e2e8f0;">${order.totalQuantity} units (${order.items.length} line items)</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Estimated Weight:</strong></td>
            <td style="padding: 10px; border: 1px solid #e2e8f0;">${order.estimatedWeightKg} kg (~${order.estimatedCartons} Master Cartons)</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Estimated Total (FOB):</strong></td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; color: #d97706;">$${order.totalAmount.toFixed(2)} USD</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Status:</strong></td>
            <td style="padding: 10px; border: 1px solid #e2e8f0;"><span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${order.status}</span></td>
          </tr>
        </table>

        <p style="color: #64748b; font-size: 14px;">You can track production progress and download the proforma invoice PDF anytime in your <a href="http://localhost:5173/my-orders" style="color: #d97706;">My Orders</a> dashboard.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">H.A. Overseas — Precision Hand Tools & Hardware Exporter</p>
      </div>
    </div>
  `;

  return sendMail({
    to: recipient,
    subject,
    html,
    text: `Order #${order.orderNumber} confirmed. Total: $${order.totalAmount} USD for ${order.totalQuantity} units. Status: ${order.status}`,
  });
};

/**
 * Send admin desk alert when an order is submitted
 */
export const sendAdminOrderNotificationEmail = async ({ order }) => {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'export@haoverseas.com';
  const subject = `[New Order Alert] #${order.orderNumber} from ${order.customerDetails?.businessName || 'Buyer'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>New Export Order Received: #${order.orderNumber}</h2>
      <p><strong>Customer:</strong> ${order.customerDetails?.customerName} (${order.customerDetails?.businessName})</p>
      <p><strong>Country:</strong> ${order.customerDetails?.country}</p>
      <p><strong>Total Units:</strong> ${order.totalQuantity} pcs | <strong>Amount:</strong> $${order.totalAmount.toFixed(2)} USD</p>
      <p><strong>Cartons:</strong> ~${order.estimatedCartons} cartons (${order.estimatedWeightKg} kg)</p>
      <p><a href="http://localhost:5173/admin" style="background: #f59e0b; color: #000; padding: 10px 16px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">Open in Admin Hub</a></p>
    </div>
  `;

  return sendMail({
    to: adminEmail,
    subject,
    html,
    text: `New order #${order.orderNumber} submitted by ${order.customerDetails?.businessName}. Total: $${order.totalAmount}`,
  });
};

/**
 * Send order status update email to buyer
 */
export const sendStatusUpdateEmail = async ({ order, user, newStatus, note }) => {
  const recipient = order.customerDetails?.email || user?.email;
  if (!recipient) return;

  const subject = `Order #${order.orderNumber} Status Update: ${newStatus}`;
  const trackingInfo = order.trackingNumber
    ? `<p style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px;"><strong>Carrier:</strong> ${order.carrierName || 'Freight Carrier'}<br/><strong>Tracking Number:</strong> ${order.trackingNumber}</p>`
    : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background-color: #0f172a; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h2 style="color: #f59e0b; margin: 0;">H.A. OVERSEAS</h2>
      </div>
      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
        <h3>Order Status Changed</h3>
        <p>Dear ${order.customerDetails?.customerName || 'Buyer'},</p>
        <p>Your export order <strong>#${order.orderNumber}</strong> has been updated to:</p>
        <div style="font-size: 18px; font-weight: bold; color: #0369a1; background: #e0f2fe; padding: 10px 16px; border-radius: 6px; display: inline-block; margin-bottom: 12px;">
          ${newStatus}
        </div>
        ${note ? `<p><em>Update Note: ${note}</em></p>` : ''}
        ${trackingInfo}
        <p style="margin-top: 20px;"><a href="http://localhost:5173/my-orders" style="color: #d97706; font-weight: bold;">View Order Details & Proforma Invoice</a></p>
      </div>
    </div>
  `;

  return sendMail({
    to: recipient,
    subject,
    html,
    text: `Your order #${order.orderNumber} status has changed to: ${newStatus}. ${note || ''}`,
  });
};
