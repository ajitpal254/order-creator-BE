import express from 'express';
import { User } from '../models/User.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { createSearchRegex } from '../utils/escapeRegExp.js';

const router = express.Router();

// @desc Get all registered customers (Admin)
// @route GET /api/users
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { search, page = 1, limit = 100 } = req.query;
    const filter = { role: 'user' };

    if (search) {
      const regex = createSearchRegex(search);
      filter.$or = [
        { customerName: regex },
        { businessName: regex },
        { email: regex },
        { username: regex },
        { country: regex },
        { phoneNumber: regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: pageNum,
      limit: limitNum,
      data: users,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc Toggle User Active Status (Admin)
// @route PATCH /api/users/:id/toggle-status
router.patch('/:id/toggle-status', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isActive = !user.isActive;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User account is now ${user.isActive ? 'Active' : 'Suspended'}`,
      isActive: user.isActive,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
