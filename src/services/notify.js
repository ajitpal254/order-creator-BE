import { Notification } from '../models/Notification.js';
import { ORDER_STATES } from '../utils/stateMachine.js';
import { sendWhatsAppTemplate } from './messaging.js';
import { logger } from '../utils/logger.js';

/**
 * In-app notifications (FEAT-01, v0.4)
 *
 * notify() creates one Notification row for a user. Like logAudit, it
 * NEVER throws into the request path: a failed notification write is
 * logged and swallowed (returns null), because notifications are not
 * part of the underlying mutation's contract.
 *
 * FEAT-11 (v0.8): WhatsApp fan-out lives here (and in the outbox
 * helpers) so existing call sites do not multiply. A caller annotates
 * its notify() call with `whatsapp: { template, parameters }` and,
 * after the in-app row is written, the messaging service sends the
 * template to the buyer IF they opted in (notifications.whatsapp) and
 * have a phone on file. sendWhatsAppTemplate never throws, and its
 * outcome never affects the in-app notification result.
 */
export const notify = async ({ user, type, title, body, link, whatsapp } = {}) => {
  try {
    if (!user || !type) return null;
    const notification = await Notification.create({
      user,
      type,
      title: title || '',
      body: body || '',
      link: link || null,
    });
    if (whatsapp?.template) {
      await sendWhatsAppTemplate({
        user,
        template: whatsapp.template,
        parameters: whatsapp.parameters || [],
      });
    }
    return notification;
  } catch (err) {
    logger.error('Failed to create notification', { error: err.message, type });
    return null;
  }
};

export const notifyOrderCreated = (order) =>
  notify({
    user: order?.user,
    type: 'order_created',
    title: `Order #${order?.orderNumber} received`,
    body: `We have received your order #${order?.orderNumber} and our export desk is reviewing it.`,
    link: '/my-orders',
  });

export const notifyOrderStatusChanged = (order, newStatus) => {
  const status = newStatus || order?.status;
  // FEAT-11: WhatsApp templates exist for the Confirmed and Shipped
  // transitions only; other statuses stay in-app/email only.
  const whatsapp =
    status === ORDER_STATES.CONFIRMED
      ? { template: 'order_confirmed_v1', parameters: [order?.orderNumber, 'Confirmed'] }
      : status === ORDER_STATES.SHIPPED
        ? { template: 'order_shipped_v1', parameters: [order?.orderNumber, 'Shipped'] }
        : undefined;
  return notify({
    user: order?.user,
    type: 'order_status_changed',
    title: `Order #${order?.orderNumber} status updated`,
    body: `Your order #${order?.orderNumber} is now ${status}.`,
    link: '/my-orders',
    whatsapp,
  });
};
