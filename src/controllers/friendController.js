import User from '../models/User.js';
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

/**
 * Add a friend by exact customId — creates a received friend request on target.
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
        message: 'Anda tidak bisa menambahkan diri sendiri sebagai teman.',
      });
    }

    const me = await User.findById(req.user._id);

    if (me.friends.includes(target._id)) {
      return res.status(409).json({
        success: false,
        error: 'already_friend',
        message: `${target.name} sudah menjadi teman Anda.`,
      });
    }
    if (me.friendRequestsSent.includes(target._id)) {
      return res.status(409).json({
        success: false,
        error: 'request_pending',
        message: 'Permintaan pertemanan sudah dikirim dan menunggu diterima.',
      });
    }
    if (me.friendRequestsReceived.includes(target._id)) {
      return res.status(409).json({
        success: false,
        error: 'already_received',
        message: `${target.name} sudah mengirim permintaan pertemanan kepada Anda. Terima permintaan tersebut.`,
      });
    }

    // Add to each other's lists atomically.
    await Promise.all([
      User.updateOne({ _id: me._id }, { $push: { friendRequestsSent: target._id } }),
      User.updateOne({ _id: target._id }, { $push: { friendRequestsReceived: me._id } }),
    ]);

    return res.status(200).json({
      success: true,
      message: `Permintaan pertemanan terkirim ke ${target.name}.`,
      target: { id: target._id, name: target.name, customId: target.customId, avatar: target.avatar, profilePic: target.profilePic },
    });
  } catch (err) {
    console.error('[addFriend]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Accept an incoming friend request.
 */
export async function acceptFriend(req, res) {
  const { userId } = req.params; // the requester's ObjectId
  try {
    const me = await User.findById(req.user._id);

    if (!me.friendRequestsReceived.includes(userId)) {
      return res.status(400).json({
        success: false,
        error: 'no_request',
        message: 'Tidak ada permintaan pertemanan dari pengguna tersebut.',
      });
    }

    await Promise.all([
      User.updateOne(
        { _id: me._id },
        {
          $pull: { friendRequestsReceived: userId },
          $addToSet: { friends: userId },
        }
      ),
      User.updateOne(
        { _id: userId },
        {
          $pull: { friendRequestsSent: me._id },
          $addToSet: { friends: me._id },
        }
      ),
    ]);

    const newFriend = await User.findById(userId).select('name email customId avatar profilePic status isOnline lastSeen');

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
 * Decline / remove an incoming friend request.
 */
export async function declineFriend(req, res) {
  const { userId } = req.params;
  try {
    await Promise.all([
      User.updateOne(
        { _id: req.user._id },
        { $pull: { friendRequestsReceived: userId } }
      ),
      User.updateOne(
        { _id: userId },
        { $pull: { friendRequestsSent: req.user._id } }
      ),
    ]);
    return res.status(200).json({ success: true, message: 'Permintaan pertemanan ditolak.' });
  } catch (err) {
    console.error('[declineFriend]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}

/**
 * Remove an existing friend (both sides).
 */
export async function removeFriend(req, res) {
  const { userId } = req.params;
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
 * List all pending friend requests (received + sent).
 */
export async function listRequests(req, res) {
  try {
    const me = await User.findById(req.user._id)
      .populate('friendRequestsReceived', 'name email customId avatar profilePic status')
      .populate('friendRequestsSent', 'name email customId avatar profilePic status');
    return res.status(200).json({
      success: true,
      received: me.friendRequestsReceived,
      sent: me.friendRequestsSent,
    });
  } catch (err) {
    console.error('[listRequests]', err);
    return res.status(500).json({ success: false, error: 'Terjadi kesalahan server' });
  }
}