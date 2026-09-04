import cloudinary from '../config/cloudinary.js';
import sharp from 'sharp';
import User from '../models/User.js';

/**
 * Upload a generic image, video, or audio file to Cloudinary.
 * Returns a secure URL + public_id.
 * The returned `media` payload is passed to socket message send.
 */
export async function uploadMedia(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Tidak ada file yang diunggah' });
  }

  try {
    const resourceType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    let buffer = req.file.buffer;
    let isWebp = false;

    // For images, process: normalize to webp (except stickers handled separately)
    if (resourceType === 'image') {
      const maxDimension = parseInt(req.query.max || '1280', 10);
      buffer = await sharp(buffer)
        .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      isWebp = true;
    }

    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          folder: `billchat/${resourceType}s`,
          format: isWebp ? 'webp' : undefined,
          // default: public_id auto-generated
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buffer);
    });

    return res.status(200).json({
      success: true,
      media: {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        size: uploaded.bytes,
        mimeType: isWebp ? 'image/webp' : req.file.mimetype,
      },
    });
  } catch (err) {
    console.error('[uploadMedia]', err);
    return res.status(500).json({ success: false, error: 'Gagal mengunggah media' });
  }
}

/**
 * Sticker maker — converts an uploaded image into a transparent-background
 * WEBP sticker (flatten white background if no alpha, or keep alpha) and
 * stores it under a `billchat/stickers` folder.
 */
export async function makeSticker(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Tidak ada gambar yang diunggah' });
  }

  try {
    const start = Date.now();
    const buffer = req.file.buffer;

    // 1) Resize to sticker size (512x512) with alpha, output webp.
    const processed = await sharp(buffer)
      .resize({ width: 512, height: 512, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, alphaQuality: 90, lossless: true })
      .toBuffer();

    // 2) Upload to cloudinary as sticker.
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'image', folder: 'billchat/stickers', format: 'webp' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(processed);
    });

    return res.status(200).json({
      success: true,
      media: {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        size: uploaded.bytes,
        mimeType: 'image/webp',
        processTimeMs: Date.now() - start,
      },
    });
  } catch (err) {
    console.error('[makeSticker]', err);
    return res.status(500).json({ success: false, error: 'Gagal membuat stiker' });
  }
}

/**
 * Upload a profile picture for the authenticated user.
 * Processes to a square avatar-sized WEBP and stores on Cloudinary,
 * then persists the URL on the user document (profilePic + avatar synced).
 */
export async function uploadProfilePic(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Tidak ada gambar yang diunggah' });
  }

  try {
    // Square 512x512 fit cover, webp 82 — good balance for avatars.
    const buffer = await sharp(req.file.buffer)
      .resize({ width: 512, height: 512, fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();

    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'billchat/avatars',
          format: 'webp',
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buffer);
    });

    const url = uploaded.secure_url;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePic: url, avatar: url },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      profilePic: url,
      user,
    });
  } catch (err) {
    console.error('[uploadProfilePic]', err);
    return res.status(500).json({ success: false, error: 'Gagal mengunggah foto profil' });
  }
}

/**
 * Delete a media asset by public_id (e.g., when a message is recalled).
 */
export async function deleteMedia(req, res) {
  const { publicId } = req.params;
  try {
    if (!publicId) {
      return res.status(400).json({ success: false, error: 'publicId diperlukan' });
    }
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[deleteMedia]', err);
    return res.status(500).json({ success: false, error: 'Gagal menghapus media' });
  }
}