import mongoose from 'mongoose';
import User from '../models/User.js';
import { notifyUser } from '../socket/index.js';
import { validationResult } from 'express-validator';

/**
 * Search users by customId / name (prefix match), returns matches excluding self.
 *
 * Search is anchored to a PREFIX match (^q) which can use the unique `customId`
 * / `name` indexes, and guarded with `maxTimeMS` so a slow query fails fast
 * with a clear message instead of timing out silently on serverless hosts.
 */
export async function searchUsers(req, res) {
  const raw = (req.query.q || '').toString().trim();
  if (!raw) {
    return res.status(400).json({ success: false, error: 'Masukkan kata kunci pencarian.' });
  }

  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    const me = await User.findById(req.user._id);

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { customId: new RegExp(`^${escaped}`, 'i') },
        { name: new RegExp(`^${escaped}`, 'i') },
      ],
    })
      .limit(50)
      .maxTimeMS(8000)
      .select('name email customId avatar profilePic status isOnline lastSeen');

    // Annotate relationship status (friend / pending / none) using the arrays
    // we already fetched with `me` — no extra populate round-trip needed.
    const friendIds = new Set((me.friends || []).map((f) => f.toString()));
    const sentIds = new Set((me.friendRequestsSent || []).map((f) => f.toString()));
    const receivedIds = new Set((me.friendRequestsReceived || []).map((f) => f.toString()));

    const result = users.map((u) => {
      const s = u._id.toString();
      let relationship = 'none';
      if (friendIds.has(s)) relationship = 'friend';
      else if (receivedIds.has(s)) relationship = 'pending_incoming';
      else if (sentIds.has(s)) relationship = 'pending_outgoing';
      return { ...u.toObject(), relationship };
    });

    return res.status(200).json({ success: true, users: result });
  } catch (err) {
    console.error('[searchUsers]', err);
    const msg =
      err && err.name === 'MongooseError' && /timed out|timeout/i.test(err.message)
        ? 'Pencarian terlalu lama, coba persempit kata kunci.'
        : 'Terjadi kesalahan server. Coba lagi.';
    return res.status(500).json({ success: false, error: msg });
  }
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function includesId(array, id) {
  if (!Array.isArray(array)) return false;
  const s = id.toString();
  return array.some((v) => v.toString() === s);
}

/**
 * Send a friend request by exact customId.
 *
 * Flow:
 *  - Already friends          -> 409 already_friend
 *  - Request already sent     -> 409 request_pending
 *  - Target already sent ME a request -> RECIPROCAL ACCEPT (we become friends at once)
 *  - Otherwise                -> pending request is created on both sides and the
 *                                target is notified in real time.
 */
export async function addFriend(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { customId } = req.body;
  const normalized = String(customId).trim().toLowerCase();

  try {
    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: 'Masukkan ID Pengguna teman yang ingin ditambahkan',
      });
    }

    const target = await User.findOne({ customId: normalized }).select(
      'name email customId avatar profilePic status'
    );
    if (!target) {
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: `Tidak menemukan pengguna dengan ID "${customId}".`,
      });
    }
    if (target._id.equals(req.user._id)) {
      return res.status(400).json({
        success: false,
        error: 'cannot_add_self',
        message: 'Anda tidak bisa menambah diri sendiri sebagai teman.',
      });
    }

    const me = await User.findById(req.user._id);
    const targetId = target._id;

    if (includesId(me.friends, targetId)) {
      return res.status(409).json({
        success: false,
        error: 'already_friend',
        message: `${target.name} sudah menjadi teman Anda.`,
      });
    }
    if (includesId(me.friendRequestsSent, targetId)) {
      return res.status(409).json({
        success: false,
        error: 'request_pending',
        message: 'Permintaan pertemanan sudah dikirim dan menunggu diterima.',
      });
    }

    // Reciprocal: target already sent ME a request -> accept both ways at once.
    if (includesId(me.friendRequestsReceived, targetId)) {
      await Promise.all([
        User.updateOne(
          { _id: me._id },
          { $pull: { friendRequestsReceived: targetId }, $addToSet: { friends: targetId } }
        ),
        User.updateOne(
          { _id: targetId },
          { $pull: { friendRequestsSent: me._id }, $addToSet: { friends: me._id } }
        ),
      ]);

      // Let the original requester know their request was accepted.
      notifyUser(targetId.toString(), 'friend:request:accepted', {
        userId: me._id.toString(),
        name: me.name,
        customId: me.customId,
        at: new Date().toISOString(),
      });

      return res.status(200).json({
        success: true,
        friend: true,
        message: `Anda dan ${target.name} kini menjadi teman.`,
        target: {
          id: target._id,
          name: target.name,
          customId: target.customId,
          avatar: target.avatar,
          profilePic: target.profilePic,
        },
      });
    }

    // Create a pending request on both sides atomically.
    await Promise.all([
      User.updateOne({ _id: me._id }, { $addToSet: { friendRequestsSent: targetId } }),
      User.updateOne({ _id: targetId }, { $addToSet: { friendRequestsReceived: me._id } }),
    ]);

    // Notify target in real time (more reliable than relying only on the client emit).
    notifyUser(targetId.toString(), 'friend:request:new', {
      fromUserId: me._id.toString(),
      name: me.name,
      customId: me.customId,
      at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      friend: false,
      message: `Permintaan pertemanan terkirim ke ${target.name}.`,
      target: {
        id: target._id,
        name: target.name,
        customId: target.customId,
        avatar: target.avatar,
        profilePic: target.profilePic,
      },
    });
  } catch (err) {
    console.error('[addFriend]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Accept an incoming friend request. The requester's account is added to the
 * receiver's friend list (and vice-versa) so both can chat immediately.
 */
export async function acceptFriend(req, res) {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ success: false, error: 'ID pengguna tidak valid' });
  }

  try {
    const me = await User.findById(req.user._id);
    const requester = await User.findById(userId);

    if (!requester) {
      return res.status(404).json({ success: false, error: 'Pengguna tidak ditemukan' });
    }

    if (!includesId(me.friendRequestsReceived, userId)) {
      return res.status(400).json({
        success: false,
        error: 'no_request',
        message: 'Tidak ada permintaan pertemanan dari pengguna tersebut.',
      });
    }

    await Promise.all([
      User.updateOne(
        { _id: me._id },
        { $pull: { friendRequestsReceived: userId }, $addToSet: { friends: userId } }
      ),
      User.updateOne(
        { _id: userId },
        { $pull: { friendRequestsSent: me._id }, $addToSet: { friends: me._id } }
      ),
    ]);

    const newFriend = await User.findById(userId).select(
      'name email customId avatar profilePic status isOnline lastSeen'
    );

    // Notify the requester so they can update their UI / friend list in real time.
    notifyUser(userId, 'friend:request:accepted', {
      userId: me._id.toString(),
      name: me.name,
      customId: me.customId,
      at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: `${newFriend.name} kini menjadi teman Anda.`,
      friend: newFriend,
    });
  } catch (err) {
    console.error('[acceptFriend]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Reject an incoming friend request — it is cancelled/removed from the pending list.
 */
export async function declineFriend(req, res) {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ success: false, error: 'ID pengguna tidak valid' });
  }

  try {
    const me = await User.findById(req.user._id);
    if (!includesId(me.friendRequestsReceived, userId)) {
      return res.status(400).json({
        success: false,
        error: 'no_request',
        message: 'Tidak ada permintaan pertemanan dari pengguna tersebut.',
      });
    }

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $pull: { friendRequestsReceived: userId } }),
      User.updateOne({ _id: userId }, { $pull: { friendRequestsSent: req.user._id } }),
    ]);

    notifyUser(userId, 'friend:request:declined', {
      userId: req.user._id.toString(),
      at: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, message: 'Permintaan pertemanan ditolak.' });
  } catch (err) {
    console.error('[declineFriend]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Cancel / withdraw a friend request I sent (removed from the pending list).
 */
export async function cancelFriendRequest(req, res) {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ success: false, error: 'ID pengguna tidak valid' });
  }

  try {
    const me = await User.findById(req.user._id);
    if (!includesId(me.friendRequestsSent, userId)) {
      return res.status(400).json({
        success: false,
        error: 'no_request',
        message: 'Tidak ada permintaan pertemanan yang dikirim ke pengguna tersebut.',
      });
    }

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $pull: { friendRequestsSent: userId } }),
      User.updateOne({ _id: userId }, { $pull: { friendRequestsReceived: req.user._id } }),
    ]);

    notifyUser(userId, 'friend:request:cancelled', {
      userId: req.user._id.toString(),
      at: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, message: 'Permintaan pertemanan dibatalkan.' });
  } catch (err) {
    console.error('[cancelFriendRequest]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Remove an existing friend (both sides).
 */
export async function removeFriend(req, res) {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ success: false, error: 'ID pengguna tidak valid' });
  }

  try {
    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $pull: { friends: userId } }),
      User.updateOne({ _id: userId }, { $pull: { friends: req.user._id } }),
    ]);
    return res.status(200).json({ success: true, message: 'Teman dihapus.' });
  } catch (err) {
    console.error('[removeFriend]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * List all friends of the current user.
 */
export async function listFriends(req, res) {
  try {
    const me = await User.findById(req.user._id)
      .populate('friends', 'name email customId avatar profilePic status isOnline lastSeen updatedAt');
    return res.status(200).json({ success: true, friends: me.friends });
  } catch (err) {
    console.error('[listFriends]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * List all pending friend requests (received + sent), newest first.
 */
export async function listRequests(req, res) {
  try {
    const me = await User.findById(req.user._id)
      .populate('friendRequestsReceived', 'name email customId avatar profilePic status')
      .populate('friendRequestsSent', 'name email customId avatar profilePic status');

    const byNewest = (a, b) => String(b._id).localeCompare(String(a._id));

    return res.status(200).json({
      success: true,
      received: (me.friendRequestsReceived || []).slice().sort(byNewest),
      sent: (me.friendRequestsSent || []).slice().sort(byNewest),
    });
  } catch (err) {
    console.error('[listRequests]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}