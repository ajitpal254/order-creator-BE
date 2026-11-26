import express from 'express';
import {
  getMyTemplates,
  createTemplate,
  deleteTemplate,
  createOrderFromTemplate,
} from '../controllers/templateController.js';
import { protect } from '../middleware/auth.js';
import { validate, createTemplateSchema } from '../middleware/validate.js';

const router = express.Router();

// FEAT-05 (v0.5): order templates — all routes authenticated and
// owner-scoped in the controller (another user's template -> 404).
router.get('/', protect, getMyTemplates);
router.post('/', protect, validate({ body: createTemplateSchema }), createTemplate);
router.delete('/:id', protect, deleteTemplate);
router.post('/:id/create-order', protect, createOrderFromTemplate);

export default router;
