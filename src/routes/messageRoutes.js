import { Router } from 'express';
import {
  getConversation,
  listConversations,
  markRead,
  pinConversation,
  deleteConversation,
  sendMessage,
} from '../controllers/messageController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

/**
 * POST   /api/messages/send               -> send a message over HTTP (serverless-safe)
 * GET    /api/messages/conversations      -> all threads (chat list)
 * POST   /api/messages/conversations/:convId/pin  -> pin / unpin a chat
 * DELETE /api/messages/conversations/:convId      -> delete a chat
 * GET    /api/messages/:peerId            -> history with a peer
 * POST   /api/messages/:peerId/read       -> mark conversation read
 *
 * NOTE: `/conversations` routes must be declared BEFORE `/:peerId`.
 */
router.post('/send', sendMessage);
router.get('/conversations', listConversations);
router.post('/conversations/:conversationId/pin', pinConversation);
router.delete('/conversations/:conversationId', deleteConversation);
router.get('/:peerId', getConversation);
router.post('/:peerId/read', markRead);

export default router;