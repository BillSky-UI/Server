import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import User from '../models/User.js';
import { verifyToken } from '../utils/jwt.js';

/**
 * In-memory mapping:  userId (string) -> array of socket ids
 * (a user may be connected from multiple devices)
 */
const onlineUsers = new Map(); // userId -> Set<socketId>
const peerSessions = new Map(); // socketId -> userId
const socketToUserId = new Map(); // socketId -> userId

let ioRef = null;

/**
 * Initializes all Socket.io real-time handlers.
 * @param {Server} io Socket.IO server instance
 */
export function initSocket(io) {
  ioRef = io;
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('UNAUTHORIZED'));
      const decoded = verifyToken(token);
      if (!decoded || !decoded.id) return next(new Error('UNAUTHORIZED'));
      socket.userId = decoded.id;
      socket.customId = decoded.customId;
      socket.userEmail = decoded.email;
      next();
    } catch (err) {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`[socket] connected user=${userId} socket=${socket.id}`);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socketToUserId.set(socket.id, userId);
    const socketIds = Array.from(onlineUsers.get(userId));

    // Mark online
    await User.updateOne({ _id: userId }, { isOnline: true, lastSeen: null });

    // Broadcast presence to friends
    broadcastPresence(io, userId, true);

    // ============ SELF / ACK ============
    socket.emit('presence:ack', { userId, sockets: socketIds });

    // ============ MESSAGING ============
    socket.on('message:send', (payload, ack) => handleSendMessage(io, socket, payload, ack));
    socket.on('message:delivered', (payload) => handleDelivered(socket, payload));
    socket.on('message:read', (payload) => handleRead(socket, payload));
    socket.on('typing', (payload) => handleTyping(io, socket, payload));

    // ============ FRIEND REQUESTS (real-time notify) ============
    socket.on('friend:request:new', (data) => handleFriendRequest(io, socket, data));

    // ============ WEBRTC SIGNALING (voice / video calls) ============
    socket.on('call:start', (data) => handleCallStart(io, socket, data));
    socket.on('call:accept', (data) => handleCallAccept(io, socket, data));
    socket.on('call:reject', (data) => handleCallReject(io, socket, data));
    socket.on('call:cancel', (data) => handleCallCancel(io, socket, data));
    socket.on('call:webrtc-offer', (data) => relayToUser(io, socket, data, 'call:webrtc-offer'));
    socket.on('call:webrtc-answer', (data) => relayToUser(io, socket, data, 'call:webrtc-answer'));
    socket.on('call:ice-candidate', (data) => relayToUser(io, socket, data, 'call:ice-candidate'));
    socket.on('call:hangup', (data) => relayToUser(io, socket, data, 'call:hangup'));

    // ---- disconnect ----
    socket.on('disconnect', async () => {
      console.log(`[socket] disconnected user=${userId} socket=${socket.id}`);
      socketToUserId.delete(socket.id);
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          await User.updateOne({ _id: userId }, { isOnline: false, lastSeen: new Date() });
          broadcastPresence(io, userId, false);
        }
      }
    });
  });

  return io;
}

/* ============================================================
  HELPERS
============================================================ */

function getUserSocketIds(userId) {
  const set = onlineUsers.get(userId);
  return set ? Array.from(set) : [];
}

function emitToUser(io, userId, event, data) {
  const ids = getUserSocketIds(userId);
  ids.forEach((sid) => {
    io.to(sid).emit(event, data);
  });
}

/**
 * Emit `event` to all sockets of `userId` (uses the module-level io ref).
 * Safe no-op when io isn't initialized (e.g. unit tests / cold start).
 */
export function notifyUser(userId, event, data) {
  if (!ioRef) return;
  emitToUser(ioRef, userId, event, data);
}

function relayToUser(io, socket, data = {}, event) {
  const { toUserId } = data;
  if (!toUserId) return;
  emitToUser(io, toUserId, event, {
    ...data,
    fromUserId: socket.userId,
    fromCustomId: socket.customId,
  });
}

async function broadcastPresence(io, userId, isOnline) {
  try {
    const user = await User.findById(userId).select('isOnline lastSeen customId name');
    const friends = await User.findById(userId).select('friends');
    (friends?.friends || []).forEach((fid) => {
      emitToUser(io, fid.toString(), 'presence:update', {
        userId,
        name: user?.name,
        customId: user?.customId,
        isOnline,
        lastSeen: isOnline ? null : new Date().toISOString(),
      });
    });
  } catch (e) {
    console.error('[presence]', e);
  }
}

/* ============================================================
  MESSAGE HANDLERS
============================================================ */

/**
 * Handle 'message:send':
 *  payload = { toUserId, encryptedText, iv, type, media? }
 *  NOTE: server NEVER decrypts. It only stores + relays the ciphertext.
 */
async function handleSendMessage(io, socket, payload = {}, ack) {
  const { toUserId, encryptedText, iv, type = 'text', media = null, clientMessageId } = payload;

  try {
    if (!toUserId) {
      return ack?.({ ok: false, error: 'receiver_missing' });
    }
    if (type === 'text' && !encryptedText) {
      return ack?.({ ok: false, error: 'empty_text' });
    }
    if (type !== 'text' && !media?.url) {
      return ack?.({ ok: false, error: 'media_missing' });
    }

    // Validate friendship (optional but recommended).
    // Self-chat (testing) is always allowed even if not "friends" with yourself.
    if (toUserId !== socket.userId) {
      const sender = await User.findById(socket.userId).select('friends');
      // `friends` holds ObjectIds while toUserId is a string — compare string forms.
      const isFriend = (sender.friends || []).some((f) => f.toString() === toUserId);
      if (!isFriend) {
        return ack?.({ ok: false, error: 'not_friend', message: 'Anda belum berteman dengan penerima' });
      }
    }

    // Find-or-create conversation
    const conv = await Conversation.findOne({
      participants: { $all: [socket.userId, toUserId].sort() },
    });
    let conversationId = conv?._id;
    if (!conv) {
      const created = await Conversation.create({
        participants: [socket.userId, toUserId].sort(),
      });
      conversationId = created._id;
    }

    // Build & persist message
    const message = await Message.create({
      sender: socket.userId,
      receiver: toUserId,
      conversationId,
      encryptedText: type === 'text' ? encryptedText : null,
      iv: type === 'text' ? iv : null,
      type,
      media: type !== 'text' ? media : null,
      status: 'sent',
    });

    // Update conversation.lastMessage
    const convUpdate = {
      $set: {
        lastMessage: message._id,
        lastMessagePreview: type === 'text' ? encryptedText.slice(0, 60) : `[${type}]`,
      },
    };
    // Count unread ONLY for the receiver, never for yourself (self-chat).
    // Otherwise messaging yourself would increment your own unread badge.
    if (toUserId !== socket.userId) {
      convUpdate.$inc = { [`unreadCounts.${toUserId}`]: 1 };
    }
    await Conversation.updateOne({ _id: conversationId }, convUpdate);

    const msgData = {
      id: message._id.toString(),
      clientMessageId: clientMessageId || null,
      fromUserId: socket.userId,
      toUserId,
      conversationId: conversationId?.toString(),
      encryptedText: message.encryptedText,
      iv: message.iv,
      type: message.type,
      media: message.media,
      timestamp: message.createdAt.toISOString(),
      status: 'sent',
    };

    // Relay to receiver (real-time)
    emitToUser(io, toUserId, 'message:new', msgData);
    // Acknowledge to sender
    ack?.({ ok: true, message: msgData });
  } catch (err) {
    console.error('[message:send]', err);
    ack?.({ ok: false, error: 'server_error', message: err.message });
  }
}

/**
 * 'message:delivered' — receiver marks a message as delivered.
 */
function handleDelivered(socket, payload = {}) {
  const { messageId } = payload;
  if (!messageId) return;
  void Message.updateOne({ _id: messageId, receiver: socket.userId }, { status: 'delivered', deliveredAt: new Date() })
    .then(() => {})
    .catch((e) => console.error('[delivered]', e));
}

/**
 * 'message:read' — receiver marks message read + relays read receipt.
 * Also zeroes the conversation's unread badge for the reading user so the
 * WhatsApp-style chat list clears its red counter when the chat is opened.
 */
async function handleRead(socket, payload = {}) {
  const { messageId, senderId } = payload;
  if (!messageId) return;
  try {
    await Message.updateOne(
      { _id: messageId, receiver: socket.userId },
      { status: 'read', readAt: new Date() }
    );
    // Reset unread badge for the conversation this message belongs to.
    const msg = await Message.findById(messageId).select('conversationId');
    if (msg?.conversationId) {
      await Conversation.updateOne(
        { _id: msg.conversationId },
        { $set: { [`unreadCounts.${socket.userId.toString()}`]: 0 } }
      );
    }
    if (senderId) {
      emitToUser(io, senderId, 'message:read-receipt', { messageId, readBy: socket.userId });
    }
  } catch (e) {
    console.error('[read]', e);
  }
}

/**
 * 'typing' — relay typing indicator to peer.
 */
function handleTyping(io, socket, payload = {}) {
  const { toUserId, isTyping } = payload;
  if (!toUserId) return;
  emitToUser(io, toUserId, 'typing', {
    fromUserId: socket.userId,
    isTyping: !!isTyping,
  });
}

/* ============================================================
  FRIEND REQUEST
============================================================ */

/**
 * 'friend:request:new' — notify target about a new friend request.
 */
function handleFriendRequest(io, socket, data = {}) {
  const { toUserId, name, customId } = data;
  if (!toUserId) return;
  emitToUser(io, toUserId, 'friend:request:new', {
    fromUserId: socket.userId,
    name: name || socket.customId,
    customId: customId || socket.customId,
    at: new Date().toISOString(),
  });
}

/* ============================================================
  WEBRTC CALL SIGNALING
============================================================ */

/**
 * 'call:start' — caller initiates a voice/video call.
 * data = { toUserId, callType: 'audio'|'video', offer? }
 */
async function handleCallStart(io, socket, data = {}) {
  const { toUserId, callType = 'video', offer } = data;
  if (!toUserId) return;

  const targetOnline = getUserSocketIds(toUserId).length > 0;
  if (!targetOnline) {
    // Inform caller the callee is offline
    return emitToUser(io, socket.userId, 'call:failed', {
      reason: 'callee_offline',
      toUserId,
    });
  }

  // Historical-style call record (optional)
  emitToUser(io, toUserId, 'call:incoming', {
    callId: `${socket.id}-${Date.now()}`,
    fromUserId: socket.userId,
    callType, // 'audio' | 'video'
    callerName: socket.customId,
    offer, // SDP offer (relayed for P2P)
    at: new Date().toISOString(),
  });

  // Notify caller that call is pending
  socket.emit('call:ringing', { toUserId, callType });
}

/**
 * 'call:accept' — callee accepts.
 * data = { toUserId, answer }
 */
function handleCallAccept(io, socket, data = {}) {
  const { toUserId, answer } = data;
  if (!toUserId) return;
  emitToUser(io, toUserId, 'call:accepted', {
    fromUserId: socket.userId,
    answer,
    at: new Date().toISOString(),
  });
}

/**
 * 'call:reject' — callee rejects.
 */
function handleCallReject(io, socket, data = {}) {
  const { toUserId, reason = 'rejected' } = data;
  if (!toUserId) return;
  emitToUser(io, toUserId, 'call:rejected', { fromUserId: socket.userId, reason });
}

/**
 * 'call:cancel' — caller cancels before pick-up.
 */
function handleCallCancel(io, socket, data = {}) {
  const { toUserId } = data;
  if (!toUserId) return;
  emitToUser(io, toUserId, 'call:cancelled', { fromUserId: socket.userId });
}

export { onlineUsers, emitToUser };