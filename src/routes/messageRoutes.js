import { Router } from 'express';
import {
  getConversation,
  listConversations,
  markRead,
} from '../controllers/messageController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

/**
 * GET /api/messages/conversations         -> all threads
 * GET /api/messages/:peerId               -> history with a peer
 * POST /api/messages/:peerId/read         -> mark conversation read
 */
router.get('/conversations', listConversations);
router.get('/:peerId', getConversation);
router.post('/:peerId/read', markRead);

export default router;