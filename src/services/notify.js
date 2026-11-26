import { Notification } from '../models/Notification.js';
import { logger } from '../utils/logger.js';

/**
 * In-app notifications (FEAT-01, v0.4)
 *
 * notify() creates one Notification row for a user. Like logAudit, it
 * NEVER throws into the request path: a failed notification write is
 * logged and swallowed (returns null), because notifications are not
 * part of the underlying mutation's contract.
 */
export const notify = async ({ user, type, title, body, link } = {}) => {
  try {
    if (!user || !type) return null;
    return await Notification.create({
      user,
      type,
      title: title || '',
      body: body || '',
      link: link || null,
    });
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

export const notifyOrderStatusChanged = (order, newStatus) =>
  notify({
    user: order?.user,
    type: 'order_status_changed',
    title: `Order #${order?.orderNumber} status updated`,
    body: `Your order #${order?.orderNumber} is now ${newStatus || order?.status}.`,
    link: '/my-orders',
  });
