import { Router } from 'express';
import { body } from 'express-validator';
import {
  searchUsers,
  addFriend,
  acceptFriend,
  declineFriend,
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
 * DELETE /api/friends/:userId
 */
router.post('/:userId/accept', acceptFriend);
router.post('/:userId/decline', declineFriend);
router.delete('/:userId', removeFriend);

export default router;