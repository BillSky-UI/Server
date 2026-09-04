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
 * Pinned conversations sort first; each item carries the peer, last message
 * preview, unread count, and a pin flag for building a WhatsApp-style chat list.
 */
export async function listConversations(req, res) {
  try {
    const myId = req.user._id;
    const myIdStr = myId.toString();

    const convs = await Conversation.find({ participants: myId })
      .populate('participants', 'name email customId avatar profilePic status isOnline')
      .populate('lastMessage');

    // Sort: pinned first, then by latest activity (fall back to updatedAt).
    const enriched = convs
      .map((c) => {
        const peer = (c.participants || []).find(
          (p) => p && p._id && p._id.toString() !== myIdStr
        );
        const self =
          (c.participants || []).find((p) => p && p._id && p._id.toString() === myIdStr) ||
          null;
        const unread = c.unreadCounts ? c.unreadCounts.get(myIdStr) || 0 : 0;
        return {
          id: c._id.toString(),
          updatedAt: c.updatedAt,
          lastMessageTime: (c.participants?.length === 1
            ? c.lastMessage?.createdAt
            : null) ?? c.lastMessage?.createdAt ?? c.updatedAt,
          pinned: Array.isArray(c.pinnedBy) && c.pinnedBy.some((x) => x.toString() === myIdStr),
          unread: unread > 0 ? unread : 0,
          lastMessagePreview: c.lastMessagePreview,
          lastMessageType: c.lastMessage?.type || null,
          lastMessageSenderId: c.lastMessage?.sender?.toString() || null,
          peer: peer
            ? {
                id: peer._id.toString(),
                name: peer.name,
                email: peer.email,
                customId: peer.customId,
                avatar: peer.profilePic || peer.avatar,
                status: peer.status,
                isOnline: peer.isOnline,
              }
            : null,
          self: self
            ? {
                id: self._id.toString(),
                name: self.name,
                customId: self.customId,
                avatar: self.profilePic || self.avatar,
              }
            : null,
        };
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
      });

    return res.status(200).json({ success: true, conversations: enriched });
  } catch (err) {
    console.error('[listConversations]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Pin / unpin a conversation for the current user.
 * body: { pinned: boolean }
 */
export async function pinConversation(req, res) {
  const { conversationId } = req.params;
  const { pinned } = req.body;
  try {
    const myId = req.user._id;
    const conv = await Conversation.findOne({ _id: conversationId, participants: myId });
    if (!conv) {
      return res.status(404).json({ success: false, error: 'Percakapan tidak ditemukan' });
    }
    if (pinned) {
      if (!conv.pinnedBy.some((x) => x.toString() === myId.toString())) {
        conv.pinnedBy.push(myId);
      }
    } else {
      conv.pinnedBy = conv.pinnedBy.filter((x) => x.toString() !== myId.toString());
    }
    await conv.save();
    return res.status(200).json({ success: true, pinned: !!pinned, conversationId });
  } catch (err) {
    console.error('[pinConversation]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Delete a chat (conversation + its messages) for the current user.
 * Simple DM semantics: removes the thread and all its messages for both sides.
 */
export async function deleteConversation(req, res) {
  const { conversationId } = req.params;
  try {
    const myId = req.user._id;
    const conv = await Conversation.findOne({ _id: conversationId, participants: myId });
    if (!conv) {
      return res.status(404).json({ success: false, error: 'Percakapan tidak ditemukan' });
    }
    await Message.deleteMany({ conversationId: conv._id });
    await Conversation.deleteOne({ _id: conv._id });
    return res.status(200).json({ success: true, conversationId });
  } catch (err) {
    console.error('[deleteConversation]', err);
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