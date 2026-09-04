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
  const allowedImages = /jpeg|jpg|png|gif|webp|heic|octet-stream|image\//;
  const allowedVideo = /mp4|mov|webm|mkv/;
  const allowedAudio = /mp3|m4a|aac|ogg/;

  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  const ok =
    allowedImages.test(mime) ||
    allowedVideo.test(mime) ||
    allowedAudio.test(mime) ||
    // Clients (e.g. Flutter MultipartFile without explicit contentType) often
    // send `application/octet-stream`; the actual format is validated later by
    // sharp during processing, so accept it and let the controller reject
    // genuinely-invalid bytes.
    (mime === 'application/octet-stream' && /\.(jpe?g|png|gif|webp|heic)$/i.test(ext));

  if (ok) return cb(null, true);
  return cb(new Error('Tipe file tidak didukung'));
};

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter,
});

export default upload;