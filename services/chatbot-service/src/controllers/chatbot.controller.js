const aiService = require('../services/ai.service');
const chatSessionRepo = require('../repositories/chatSession.repository');

class ChatbotController {
  /**
   * POST /api/ai/chat
   * Send message and get AI response
   */
  async sendMessage(req, res) {
    try {
      const { message } = req.body;
      const userId = req.user?.userId || req.user?._id;

      if (!message || message.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Tin nhắn không được để trống'
        });
      }

      // Check if message is dental-related
      if (!aiService.isDentalRelated(message)) {
        const rejectMessage = 'Xin lỗi, tôi chỉ có thể hỗ trợ các vấn đề liên quan đến phòng khám nha khoa SmileCare. Bạn có câu hỏi nào về răng miệng không? 😊';
        
        return res.json({
          success: true,
          response: rejectMessage,
          timestamp: new Date().toISOString()
        });
      }

      // Get or create session
      const session = await chatSessionRepo.getOrCreateSession(userId);

      // Add user message to session
      await chatSessionRepo.addMessage(session.sessionId, 'user', message);

      // Get conversation history (last 10 messages for context)
      const history = await chatSessionRepo.getHistory(userId, 10);
      const formattedMessages = aiService.formatMessagesForGPT(history);

      // Get auth token from request (for authenticated API calls)
      const authToken = req.headers.authorization?.split(' ')[1] || null;

      // Get GPT response (with API integration)
      const result = await aiService.sendMessageToGPT(formattedMessages, undefined, authToken);

      // Save assistant response
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', result.response);

      res.json({
        success: true,
        response: result.response,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString(),
        usedApi: result.usedApi || false,
        apiAction: result.action || null
      });

    } catch (error) {
      console.error('❌ Chat error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Có lỗi xảy ra khi xử lý tin nhắn'
      });
    }
  }

  /**
   * GET /api/ai/history
   * Get chat history for current user
   */
  async getChatHistory(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const limit = parseInt(req.query.limit) || 50;

      const history = await chatSessionRepo.getHistory(userId, limit);

      res.json({
        success: true,
        data: history,
        total: history.length
      });

    } catch (error) {
      console.error('❌ Get history error:', error);
      res.status(500).json({
        success: false,
        message: 'Không thể lấy lịch sử chat'
      });
    }
  }

  /**
   * DELETE /api/ai/history
   * Clear chat history for current user
   */
  async clearHistory(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;

      const session = await chatSessionRepo.findActiveByUserId(userId);
      
      if (session) {
        await chatSessionRepo.deactivateSession(session.sessionId);
      }

      res.json({
        success: true,
        message: 'Đã xóa lịch sử chat thành công'
      });

    } catch (error) {
      console.error('❌ Clear history error:', error);
      res.status(500).json({
        success: false,
        message: 'Không thể xóa lịch sử chat'
      });
    }
  }
}

module.exports = new ChatbotController();
