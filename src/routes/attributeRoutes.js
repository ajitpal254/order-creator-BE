import express from 'express';
import {
  getAllAttributes,
  getFinishes,
  addFinish,
  updateFinish,
  deleteFinish,
  getColors,
  addColor,
  updateColor,
  deleteColor,
  getBrands,
  addBrand,
  updateBrand,
  deleteBrand,
  getSizes,
  addSize,
  updateSize,
  deleteSize,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/attributeController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// Master bundle (public/user)
router.get('/', getAllAttributes);

// Finishes
router.get('/finishes', getFinishes);
router.post('/finishes', protect, adminOnly, addFinish);
router.put('/finishes/:id', protect, adminOnly, updateFinish);
router.delete('/finishes/:id', protect, adminOnly, deleteFinish);

// Colors
router.get('/colors', getColors);
router.post('/colors', protect, adminOnly, addColor);
router.put('/colors/:id', protect, adminOnly, updateColor);
router.delete('/colors/:id', protect, adminOnly, deleteColor);

// Brands
router.get('/brands', getBrands);
router.post('/brands', protect, adminOnly, addBrand);
router.put('/brands/:id', protect, adminOnly, updateBrand);
router.delete('/brands/:id', protect, adminOnly, deleteBrand);

// Sizes
router.get('/sizes', getSizes);
router.post('/sizes', protect, adminOnly, addSize);
router.put('/sizes/:id', protect, adminOnly, updateSize);
router.delete('/sizes/:id', protect, adminOnly, deleteSize);

// Categories
router.get('/categories', getCategories);
router.post('/categories', protect, adminOnly, addCategory);
router.put('/categories/:id', protect, adminOnly, updateCategory);
router.delete('/categories/:id', protect, adminOnly, deleteCategory);

export default router;
