import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import config from '../config/index.js';

/**
 * Multer storage — in-memory (buffer) so we can upload directly to
 * Cloudinary without writing to disk. Bytes are kept in RAM, acceptable
 * for mobile-file scale; use diskStorage for very large files.
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedImages = /jpeg|jpg|png|gif|webp|heic/;
  const allowedVideo = /mp4|mov|webm|mkv/;
  const allowedAudio = /mp3|m4a|aac|ogg/;

  const ext = path.extname(file.originalname).toLowerCase();
  const ok =
    allowedImages.test(file.mimetype) ||
    allowedVideo.test(file.mimetype) ||
    allowedAudio.test(file.mimetype);

  if (ok) return cb(null, true);
  return cb(new Error('Tipe file tidak didukung'));
};

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter,
});

export default upload;