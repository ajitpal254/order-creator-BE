import express from 'express';
import { protect } from '../middleware/auth.js';
import { Notification } from '../models/Notification.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';

/**
 * Notification routes (FEAT-01, v0.4) — mounted at /api/notifications.
 * Every route is authenticated and scoped to the caller's own
 * notifications; another user's notification is reported as 404.
 */
const router = express.Router();

// @desc List the caller's notifications (newest first, paginated)
// @route GET /api/notifications?unread=true
router.get('/', protect, async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.unread === 'true') filter.read = false;

    const { page, limit, skip } = parsePagination(req);
    const [items, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
    ]);
    return paginatedResponse(res, { items, total, page, limit });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc Count the caller's unread notifications
// @route GET /api/notifications/unread-count
router.get('/unread-count', protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ user: req.user._id, read: false });
    return res.status(200).json({ success: true, count });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc Mark one of the caller's notifications as read
// @route PATCH /api/notifications/:id/read
router.patch('/:id/read', protect, async (req, res) => {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, user: req.user._id });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    notification.read = true;
    await notification.save();
    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc Mark all of the caller's unread notifications as read
// @route POST /api/notifications/read-all
router.post('/read-all', protect, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ success: true, count: result.modifiedCount ?? 0 });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
