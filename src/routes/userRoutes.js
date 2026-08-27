import express from 'express';
import { User } from '../models/User.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// @desc Get all registered customers (Admin)
// @route GET /api/users
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { role: 'user' };

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { customerName: regex },
        { businessName: regex },
        { email: regex },
        { username: regex },
        { country: regex },
        { phoneNumber: regex },
      ];
    }

    const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: users.length, data: users });
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
