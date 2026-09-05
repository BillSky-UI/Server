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
    // `friends` holds ObjectIds while peerId is a string — compare string forms.
    const isFriend = (req.user.friends || []).some((f) => f.toString() === peerId);
    if (!myId.equals(peerId) && !isFriend) {
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
        const myIdStrB = myIdStr;
        const peer =
          (c.participants || []).find(
            (p) => p && p._id && p._id.toString() !== myIdStrB
          ) || null;
        const self =
          (c.participants || []).find((p) => p && p._id && p._id.toString() === myIdStrB) ||
          null;
        // Self-chat: participants are [me, me], so there is no "other" user.
        // Fall back to "self" so the chat list still shows *a* contact (yourself)
        // and can open the self-chat history screen.
        const displayPeer = peer || self;
        const isSelfChat = peer == null;
        const unread = c.unreadCounts ? c.unreadCounts.get(myIdStr) || 0 : 0;
        return {
          id: c._id.toString(),
          updatedAt: c.updatedAt,
          lastMessageTime: c.lastMessage?.createdAt ?? c.updatedAt,
          pinned: Array.isArray(c.pinnedBy) && c.pinnedBy.some((x) => x.toString() === myIdStr),
          unread: unread > 0 ? unread : 0,
          isSelfChat,
          // Full encrypted payload of the last message so clients can decrypt
          // and render a real WhatsApp-style preview (never store plaintext).
          lastMessageEncryptedText: c.lastMessage?.encryptedText ?? null,
          lastMessageIv: c.lastMessage?.iv ?? null,
          lastMessageType: c.lastMessage?.type || null,
          lastMessageSenderId: c.lastMessage?.sender?.toString() || null,
          peer: displayPeer
            ? {
                id: displayPeer._id.toString(),
                name: displayPeer.name,
                email: displayPeer.email,
                customId: displayPeer.customId,
                avatar: displayPeer.profilePic || displayPeer.avatar,
                status: displayPeer.status,
                isOnline: displayPeer.isOnline,
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

/**
 * Send a message over plain HTTP.
 *
 * This is the REST twin of the Socket.io `message:send` handler. It exists so
 * the app still works on serverless hosts (e.g. Vercel) where a persistent
 * WebSocket connection cannot be kept alive: clients POST the (already
 * client-side encrypted) payload, the server persists it and updates the
 * conversation's last-message preview + unread counter, exactly like the
 * socket path. If the receiver has a live socket it is still notified in real
 * time via `emitToUser`.
 */
export async function sendMessage(req, res) {
  const { toUserId, encryptedText, iv, type = 'text', media = null, clientMessageId = null } =
    req.body || {};

  try {
    if (!toUserId) {
      return res.status(400).json({ success: false, error: 'receiver_missing' });
    }
    if (type === 'text' && !encryptedText) {
      return res.status(400).json({ success: false, error: 'empty_text' });
    }
    if (type !== 'text' && !media?.url) {
      return res.status(400).json({ success: false, error: 'media_missing' });
    }

    const senderId = req.user._id;
    if (toUserId !== senderId.toString()) {
      // Friendship check (same semantics as the socket handler).
      const sender = await User.findById(senderId).select('friends');
      const isFriend = (sender.friends || []).some((f) => f.toString() === toUserId);
      if (!isFriend) {
        return res.status(403).json({
          success: false,
          error: 'not_friend',
          message: 'Anda belum berteman dengan penerima',
        });
      }
    }

    // Find-or-create conversation
    const pair = [senderId, toUserId].sort();
    let conv = await Conversation.findOne({ participants: { $all: pair } });
    if (!conv) {
      conv = await Conversation.create({ participants: pair });
    }

    const message = await Message.create({
      sender: senderId,
      receiver: toUserId,
      conversationId: conv._id,
      encryptedText: type === 'text' ? encryptedText : null,
      iv: type === 'text' ? iv : null,
      type,
      media: type !== 'text' ? media : null,
      status: 'sent',
    });

    const convUpdate = {
      $set: {
        lastMessage: message._id,
        lastMessagePreview: type === 'text' ? String(encryptedText).slice(0, 60) : `[${type}]`,
      },
    };
    if (toUserId !== senderId.toString()) {
      convUpdate.$inc = { [`unreadCounts.${toUserId}`]: 1 };
    }
    await Conversation.updateOne({ _id: conv._id }, convUpdate);

    const msgData = {
      id: message._id.toString(),
      clientMessageId: clientMessageId || null,
      fromUserId: senderId.toString(),
      toUserId,
      conversationId: conv._id.toString(),
      encryptedText: message.encryptedText,
      iv: message.iv,
      type: message.type,
      media: message.media,
      timestamp: message.createdAt.toISOString(),
      status: 'sent',
    };

    // Real-time relay when the receiver has a live socket (if any).
    try {
      const { notifyUser } = await import('../socket/index.js');
      notifyUser(toUserId, 'message:new', msgData);
    } catch (e) {
      // socket bridge unavailable — the receiver will pick the message up via
      // polling / next conversation refresh. Not fatal.
    }

    return res.status(200).json({ success: true, message: msgData });
  } catch (err) {
    console.error('[sendMessage]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}