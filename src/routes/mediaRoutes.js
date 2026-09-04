import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import {
  uploadMedia,
  makeSticker,
  uploadProfilePic,
  deleteMedia,
} from '../controllers/mediaController.js';

const router = Router();
router.use(protect);

/**
 * POST /api/media/upload        -> image/video/audio -> cloudinary
 * POST /api/media/sticker       -> image -> transparent WEBP sticker
 * POST /api/media/profile-pic   -> image -> avatar square, updates user
 * DELETE /api/media/:publicId   -> remove asset
 */
router.post('/upload', upload.single('file'), uploadMedia);
router.post('/sticker', upload.single('image'), makeSticker);
router.post('/profile-pic', upload.single('file'), uploadProfilePic);
router.delete('/:publicId', deleteMedia);

export default router;