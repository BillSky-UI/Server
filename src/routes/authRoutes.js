import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  me,
  updateProfile,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user. customId uniqueness is enforced (checked + DB index).
 */
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Nama wajib diisi'),
    body('email').isEmail().withMessage('Email tidak valid'),
    body('password').isLength({ min: 8 }).withMessage('Password minimal 8 karakter'),
    body('customId')
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage('ID Pengguna harus 3-30 karakter')
      .matches(/^[a-zA-Z0-9_.-]+$/)
      .withMessage('ID hanya huruf, angka, titik, underscore, strip'),
  ],
  register
);

/**
 * POST /api/auth/login
 */
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email tidak valid'),
    body('password').notEmpty().withMessage('Password wajib diisi'),
  ],
  login
);

/**
 * GET /api/auth/me  —   current profile + friends + requests
 */
router.get('/me', protect, me);

/**
 * PUT /api/auth/me  —   update name/status/avatar
 */
router.put('/me', protect, updateProfile);

export default router;