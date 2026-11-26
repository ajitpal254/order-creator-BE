import express from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { protect, adminOnly, authorizeRoles } from '../middleware/auth.js';
import { listRfq, updateRfqStatus } from '../controllers/rfqController.js';
const STAFF_ROLES = ['admin','sales_manager','production_supervisor','qc_inspector','shipping_officer','super_admin'];

const router = express.Router();

// @desc Get audit logs (Admin / Super Admin only)
// @route GET /api/admin/audit-logs
// Filters: entityType, entityId, actor, action. Newest first, paginated
// with the established list envelope {success,count,total,page,limit,data}.
router.get('/audit-logs', protect, adminOnly, async (req, res) => {
  try {
    const { entityType, entityId, actor, action, page = 1, limit = 100 } = req.query;

    const filter = {};
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = entityId.toString();
    if (actor) filter.actor = actor;
    if (action) filter.action = action;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      AuditLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: logs.length,
      total,
      page: pageNum,
      limit: limitNum,
      data: logs,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/rfq', protect, authorizeRoles(...STAFF_ROLES), listRfq);
router.patch('/rfq/:id', protect, authorizeRoles(...STAFF_ROLES), updateRfqStatus);

export default router;
