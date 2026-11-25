import express from 'express';
import {
  createAddress,
  getMyAddresses,
  getAddressById,
  updateAddress,
  deleteAddress,
} from '../controllers/addressController.js';
import { protect } from '../middleware/auth.js';
import { validate, createAddressSchema, updateAddressSchema } from '../middleware/validate.js';

const router = express.Router();

// FEAT-05 (v0.5): address book — all routes authenticated and
// owner-scoped in the controller (another user's address -> 404).
router.post('/', protect, validate({ body: createAddressSchema }), createAddress);
router.get('/', protect, getMyAddresses);
router.get('/:id', protect, getAddressById);
router.put('/:id', protect, validate({ body: updateAddressSchema }), updateAddress);
router.delete('/:id', protect, deleteAddress);

export default router;
