import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import User from '../models/User.js';

/**
 * Get conversation history between current user and a peer.
 * Paginated with cursor-based pagination (before timestamp/id).
 */
export async function getConversation(req, res) {
  const { peerId } = req.params;
  const { limit = 50, before } = req.query;

  try {
    const peer = await User.findById(peerId);
    if (!peer) {
      return res.status(404).json({ success: false, error: 'Pengguna tidak ditemukan' });
    }

    const myId = req.user._id;
    // Ensure the peer is a friend before exposing history.
    if (!myId.equals(peerId) && !req.user.friends.includes(peerId)) {
      return res.status(403).json({
        success: false,
        error: 'not_friend',
        message: 'Anda belum berteman dengan pengguna ini.',
      });
    }

    const query = {
      $or: [
        { sender: myId, receiver: peerId },
        { sender: peerId, receiver: myId },
      ],
    };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10) || 50);

    return res.status(200).json({
      success: true,
      messages: messages.reverse(), // chronological
      peer: { id: peer._id, name: peer.name, customId: peer.customId, avatar: peer.avatar },
    });
  } catch (err) {
    console.error('[getConversation]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * List all conversations (threads) for current user.
 */
export async function listConversations(req, res) {
  try {
    const myId = req.user._id;
    const convs = await Conversation.find({ participants: myId })
      .sort({ updatedAt: -1 })
      .populate('participants', 'name email customId avatar status isOnline')
      .populate('lastMessage');

    return res.status(200).json({ success: true, conversations: convs });
  } catch (err) {
    console.error('[listConversations]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Mark a conversation as read by current user.
 */
export async function markRead(req, res) {
  const { peerId } = req.params;
  try {
    const pair = [req.user._id, peerId].sort();
    const conv = await Conversation.findOne({ participants: { $all: pair } });
    if (conv) {
      conv.unreadCounts.set(req.user._id.toString(), 0);
      await conv.save();
    }
    // Also update message read status for messages sent to me.
    await Message.updateMany(
      { sender: peerId, receiver: req.user._id, status: { $ne: 'read' } },
      { $set: { status: 'read', readAt: new Date() } }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[markRead]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}