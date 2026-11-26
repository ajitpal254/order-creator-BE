import mongoose from 'mongoose';
import { Address } from '../models/Address.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';

/**
 * Address book (FEAT-05, v0.5) — /api/addresses.
 *
 * Full CRUD, every route authenticated (protect) and owner-scoped:
 * addresses are only ever queried with { user: req.user._id }, so
 * another user's address is indistinguishable from a missing one
 * (404, SEC-01).
 */

const findOwnAddress = (id, userId) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Address.findOne({ _id: id, user: userId });
};

// @desc Create an address
// @route POST /api/addresses
export const createAddress = async (req, res) => {
  try {
    const address = await Address.create({ ...req.body, user: req.user._id });
    return res.status(201).json({ success: true, data: address });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc List the caller's addresses (paginated envelope)
// @route GET /api/addresses
export const getMyAddresses = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    const { page, limit, skip } = parsePagination(req);
    const [addresses, total] = await Promise.all([
      Address.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Address.countDocuments(filter),
    ]);
    return paginatedResponse(res, { items: addresses, total, page, limit });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get one of the caller's addresses
// @route GET /api/addresses/:id
export const getAddressById = async (req, res) => {
  try {
    const address = await findOwnAddress(req.params.id, req.user._id);
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    return res.status(200).json({ success: true, data: address });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Update one of the caller's addresses
// @route PUT /api/addresses/:id
export const updateAddress = async (req, res) => {
  try {
    const address = await findOwnAddress(req.params.id, req.user._id);
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    for (const [key, value] of Object.entries(req.body)) {
      if (value !== undefined) address[key] = value;
    }
    await address.save();
    return res.status(200).json({ success: true, data: address });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Delete one of the caller's addresses
// @route DELETE /api/addresses/:id
export const deleteAddress = async (req, res) => {
  try {
    const address = await findOwnAddress(req.params.id, req.user._id);
    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    await address.deleteOne();
    return res.status(200).json({ success: true, message: 'Address deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
