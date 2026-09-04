import mongoose from 'mongoose';

/**
 * Message Schema — a single chat message.
 *
 * Security note:
 *  - `encryptedText` holds the AES-GCM (client-side) ciphertext + IV.
 *  - `decryptedText` is ONLY a mirrored field for debugging; in production
 *    you should NEVER store plaintext. We keep only the ciphertext below.
 *  - Media messages store `mediaId` (Cloudinary public_id) + secure URL.
 */
const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      index: true,
    },

    // ---- E2EE text payload ----
    encryptedText: {
      type: String,
      default: null, // base64(ciphertext) — set when type === 'text'
    },
    iv: {
      type: String,
      default: null, // base64(iv) — must be unique per message for AES-GCM
    },
    sha256Fingerprint: {
      type: String,
      default: null, // HMAC/sha256 of ciphertext for integrity verification (optional)
    },

    // ---- Media / sticker metadata ----
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'sticker', 'audio'],
      default: 'text',
    },
    media: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
      size: { type: Number, default: null },
      mimeType: { type: String, default: null },
    },

    // ---- Read / delivery tracking ----
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },

    // Reply-to chain (optional).
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ status: 1 });

const Message = mongoose.model('Message', messageSchema);
export default Message;