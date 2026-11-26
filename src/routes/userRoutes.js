import express from 'express';
import { User } from '../models/User.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { createSearchRegex } from '../utils/escapeRegExp.js';
import { logAudit } from '../utils/audit.js';

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

    const before = { isActive: user.isActive };
    user.isActive = !user.isActive;
    await user.save();

    // SEC-10: audit the status change
    await logAudit(req, {
      action: 'user.status.toggle',
      entityType: 'User',
      entityId: user._id,
      before,
      after: { isActive: user.isActive },
    });

    return res.status(200).json({
      success: true,
      message: `User account is now ${user.isActive ? 'Active' : 'Suspended'}`,
      isActive: user.isActive,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @desc Change a user's role (Admin)
// @route PATCH /api/users/:id/role
// NOTE (SEC-10): no role-change endpoint existed before v0.3 — roles
// were only ever set at signup/seed time, so there was no mutation
// point to audit. This endpoint is that point; every change is
// written to the audit log with before/after roles.
const VALID_ROLES = [
  'user',
  'buyer',
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

router.patch('/:id/role', protect, adminOnly, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`,
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const before = { role: user.role };
    user.role = role;
    await user.save();

    await logAudit(req, {
      action: 'user.role.change',
      entityType: 'User',
      entityId: user._id,
      before,
      after: { role: user.role },
    });

    return res.status(200).json({
      success: true,
      message: `User role is now ${user.role}`,
      data: { _id: user._id, role: user.role },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
