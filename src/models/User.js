import mongoose from 'mongoose';

/**
 * User Schema — one document per registered account.
 *
 * `customId` is the user-chosen public identifier (like WhatsApp username),
 * it must ALWAYS be unique so friends can add each other by it.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nama wajib diisi'],
      trim: true,
      minlength: [1, 'Nama terlalu pendek'],
      maxlength: [80, 'Nama terlalu panjang'],
    },
    email: {
      type: String,
      required: [true, 'Email wajib diisi'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Format email tidak valid'],
    },
    customId: {
      type: String,
      required: [true, 'ID Pengguna wajib diisi'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
      minlength: [3, 'ID minimal 3 karakter'],
      maxlength: [30, 'ID maksimal 30 karakter'],
      match: [
        /^[a-zA-Z0-9_.-]+$/,
        'ID hanya boleh berisi huruf, angka, titik, underscore, dan strip',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password wajib diisi'],
      select: false, // never fetched by default
      minlength: [8, 'Password minimal 8 karakter'],
    },
    avatar: {
      type: String,
      default: null,
    },
    // Profile picture uploaded via Cloudinary (kept as a first-class field).
    profilePic: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      trim: true,
      maxlength: [160, 'Status terlalu panjang'],
      default: 'Halo, saya menggunakan BillChat!',
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    publicKey: {
      // For full E2EE workflows clients exchange public keys; stored here for key distribution.
      type: String,
      default: null,
    },
    // List of other users the current user has added as friends.
    friends: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Pending friend requests SENT by this user (awaiting acceptance).
    friendRequestsSent: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Pending friend requests RECEIVED by this user.
    friendRequestsReceived: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Pre-save hook can be used to sanitize customId (e.g. normalize case).
userSchema.pre('save', function sanitize(next) {
  if (this.isModified('customId')) {
    this.customId = this.customId.trim().toLowerCase();
  }
  next();
});

// Compound index to make friend lookups faster.
userSchema.index({ friends: 1 });
userSchema.index({ friendRequestsReceived: 1 });
userSchema.index({ friendRequestsSent: 1 });

const User = mongoose.model('User', userSchema);
export default User;