const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// GET /api/chat/conversations - Lấy danh sách conversations
router.get('/conversations', chatController.getConversations);

// GET /api/chat/conversations/search - Tìm kiếm conversations
router.get('/conversations/search', chatController.searchConversations);

// GET /api/chat/conversations/:conversationId - Lấy conversation theo ID
router.get('/conversations/:conversationId', chatController.getConversation);

// GET /api/chat/conversations/:conversationId/messages - Lấy tin nhắn
router.get('/conversations/:conversationId/messages', chatController.getMessages);

// POST /api/chat/conversations/:conversationId/messages - Gửi tin nhắn
router.post('/conversations/:conversationId/messages', chatController.sendMessage);

// PUT /api/chat/conversations/:conversationId/read - Đánh dấu đã đọc
router.put('/conversations/:conversationId/read', chatController.markAsRead);

// Webhook route for creating conversation from completed record (no auth needed)
router.post('/webhook/record-completed', chatController.createConversationFromRecord);

module.exports = router;