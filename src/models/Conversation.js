import mongoose from 'mongoose';

/**
 * Conversation Schema — a 1-on-1 DM thread between two users.
 * Unique on (participants) pair to prevent duplicate threads.
 */
const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastMessagePreview: {
      type: String,
      default: null, // may hold truncated ENCRYPTED text only, never plaintext
    },
    unreadCounts: {
      // Map<userId, number>
      type: Map,
      of: Number,
      default: {},
    },
    mutedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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

// Ensure a conversation only exists once per user-pair.
conversationSchema.index({ participants: 1 }, { unique: true });
conversationSchema.index({ updatedAt: -1 });

/**
 * Static helper: find-or-create a conversation between two users.
 */
conversationSchema.statics.findOrCreate = async function (userIdA, userIdB) {
  const pair = [userIdA, userIdB].sort();
  let conv = await this.findOne({ participants: { $all: pair } }).populate(
    'participants',
    'name email customId avatar isOnline'
  );
  if (!conv) {
    conv = await this.create({ participants: pair });
  }
  return conv;
};

const Conversation = mongoose.model('Conversation', conversationSchema);
export default Conversation;