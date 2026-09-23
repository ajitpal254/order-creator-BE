import express from 'express';
import {
  signup,
  login,
  googleAuth,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  refreshTokenHandler,
  logout,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { validate, signupSchema, loginSchema } from '../middleware/validate.js';

const router = express.Router();

router.post('/signup', validate({ body: signupSchema }), signup);
router.post('/login', validate({ body: loginSchema }), login);
router.post('/google', googleAuth);
router.post('/refresh', refreshTokenHandler);
router.post('/logout', protect, logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

export default router;
