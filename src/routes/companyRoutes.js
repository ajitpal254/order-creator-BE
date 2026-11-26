import express from 'express';
import {
  createCompany,
  getMyCompanies,
  getCompanyById,
  updateCompany,
  addCompanyMember,
  updateCompanyMemberRole,
  removeCompanyMember,
  getCompanyOrders,
} from '../controllers/companyController.js';
import { protect } from '../middleware/auth.js';

/**
 * Company routes (FEAT-10, v0.9) — mounted at /api/companies.
 * Every route requires authentication; membership/ownership rules are
 * enforced inside the controller (non-members get 404, see there).
 */
const router = express.Router();

router.post('/', protect, createCompany);
router.get('/mine', protect, getMyCompanies);
router.get('/:id', protect, getCompanyById);
router.patch('/:id', protect, updateCompany);
router.post('/:id/members', protect, addCompanyMember);
router.patch('/:id/members/:userId', protect, updateCompanyMemberRole);
router.delete('/:id/members/:userId', protect, removeCompanyMember);
router.get('/:id/orders', protect, getCompanyOrders);

export default router;
