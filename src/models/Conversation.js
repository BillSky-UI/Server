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
    pairKey: {
      type: String,
    },
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

// A conversation is unique per user-pair. A unique index on the array field
// itself (the old `participants: 1` index) incorrectly blocks a user from
// having more than ONE conversation, so uniqueness is enforced by `pairKey`.
conversationSchema.index({ pairKey: 1 }, { unique: true, sparse: true });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

conversationSchema.statics.pairKeyFor = function (userIdA, userIdB) {
  return [String(userIdA), String(userIdB)].sort().join(':');
};

/**
 * Static helper: find-or-create a conversation between two users.
 */
conversationSchema.statics.findOrCreate = async function (userIdA, userIdB) {
  // De-duplicate so a self-chat is a single-participant conversation. Without
  // this, `$all: [me, me]` matches ANY conversation that contains me (e.g. the
  // chat with a friend), so messages to yourself landed in the wrong thread
  // and no self-chat card ever appeared on the home screen.
  const pair = [...new Set([String(userIdA), String(userIdB)])].sort();
  const pairKey = pair.join(':');
  const isSelf = pair.length === 1;

  let conv = await this.findOne({ pairKey });
  if (!conv) {
    conv = await this.findOne(
      isSelf
        ? { participants: { $all: pair, $size: 1 } }
        : { participants: { $all: pair } }
    );
  }
  if (!conv) {
    try {
      conv = await this.create({ participants: pair, pairKey });
    } catch (err) {
      if (err.code === 11000) {
        conv = await this.findOne({ pairKey });
      } else {
        throw err;
      }
    }
  } else if (!conv.pairKey) {
    conv.pairKey = pairKey;
    await conv.save().catch(() => {});
  }

  await conv.populate('participants', 'name email customId avatar isOnline');
  return conv;
};

const Conversation = mongoose.model('Conversation', conversationSchema);
export default Conversation;