import { Router } from 'express';
import { body } from 'express-validator';
import {
  searchUsers,
  addFriend,
  acceptFriend,
  declineFriend,
  cancelFriendRequest,
  removeFriend,
  listFriends,
  listRequests,
} from '../controllers/friendController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.use(protect);

/**
 * GET /api/friends/search?q=...
 */
router.get('/search', searchUsers);

/**
 * GET /api/friends                       -> list friends
 * GET /api/friends/requests              -> pending requests (received + sent)
 */
router.get('/', listFriends);
router.get('/requests', listRequests);

/**
 * POST /api/friends/add                  -> add by customId
 */
router.post(
  '/add',
  [body('customId').trim().notEmpty().withMessage('Masukkan ID Pengguna')],
  addFriend
);

/**
 * POST /api/friends/:userId/accept
 * POST /api/friends/:userId/decline
 * POST /api/friends/:userId/cancel      -> withdraw a sent request
 * DELETE /api/friends/:userId
 */
router.post('/:userId/accept', acceptFriend);
router.post('/:userId/decline', declineFriend);
router.post('/:userId/cancel', cancelFriendRequest);
router.delete('/:userId', removeFriend);

export default router;