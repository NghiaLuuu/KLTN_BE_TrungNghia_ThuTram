const chatService = require('../services/chat.service');

class ChatController {
  // Lấy danh sách conversations
  async getConversations(req, res) {
    try {
      const { userId, role } = req.user;
      const userType = ['doctor', 'admin', 'manager'].includes(role) ? 'doctor' : 'patient';
      
      const conversations = await chatService.getUserConversations(userId, userType);
      
      res.status(200).json({
        success: true,
        data: conversations,
        message: 'Conversations retrieved successfully'
      });
    } catch (error) {
      console.error('❌ Error in getConversations:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Lấy conversation theo ID
  async getConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      
      const conversation = await chatService.getConversationById(conversationId, userId);
      
      res.status(200).json({
        success: true,
        data: conversation,
        message: 'Conversation retrieved successfully'
      });
    } catch (error) {
      console.error('❌ Error in getConversation:', error);
      res.status(error.message.includes('not found') ? 404 : 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Lấy tin nhắn trong conversation
  async getMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId } = req.user;
      const { page = 1, limit = 50 } = req.query;
      
      const messages = await chatService.getMessages(
        conversationId, 
        userId, 
        parseInt(page), 
        parseInt(limit)
      );
      
      res.status(200).json({
        success: true,
        data: messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit)
        },
        message: 'Messages retrieved successfully'
      });
    } catch (error) {
      console.error('❌ Error in getMessages:', error);
      res.status(error.message.includes('not found') ? 404 : 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Gửi tin nhắn (REST API backup cho Socket.IO)
  async sendMessage(req, res) {
    try {
      const { conversationId } = req.params;
      const { content, messageType = 'text' } = req.body;
      const { userId, role } = req.user;
      
      if (!content || content.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Message content is required'
        });
      }

      const userType = ['doctor', 'admin', 'manager'].includes(role) ? 'doctor' : 'patient';
      
      const message = await chatService.sendMessage(
        conversationId,
        userId,
        userType,
        content.trim(),
        messageType
      );
      
      res.status(201).json({
        success: true,
        data: message,
        message: 'Message sent successfully'
      });
    } catch (error) {
      console.error('❌ Error in sendMessage:', error);
      res.status(error.message.includes('not found') ? 404 : 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Đánh dấu tin nhắn đã đọc
  async markAsRead(req, res) {
    try {
      const { conversationId } = req.params;
      const { userId, role } = req.user;
      
      const userType = ['doctor', 'admin', 'manager'].includes(role) ? 'doctor' : 'patient';
      
      await chatService.markMessagesAsRead(conversationId, userId, userType);
      
      res.status(200).json({
        success: true,
        message: 'Messages marked as read'
      });
    } catch (error) {
      console.error('❌ Error in markAsRead:', error);
      res.status(error.message.includes('not found') ? 404 : 500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Tìm kiếm conversations
  async searchConversations(req, res) {
    try {
      const { q } = req.query;
      const { userId, role } = req.user;
      
      if (!q || q.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
      }

      const userType = ['doctor', 'admin', 'manager'].includes(role) ? 'doctor' : 'patient';
      
      const conversations = await chatService.searchConversations(userId, userType, q.trim());
      
      res.status(200).json({
        success: true,
        data: conversations,
        message: 'Search completed successfully'
      });
    } catch (error) {
      console.error('❌ Error in searchConversations:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  // Tạo conversation từ record (webhook từ record-service)
  async createConversationFromRecord(req, res) {
    try {
      const recordData = req.body;
      
      const conversation = await chatService.createConversationFromRecord(recordData);
      
      res.status(201).json({
        success: true,
        data: conversation,
        message: 'Conversation created successfully'
      });
    } catch (error) {
      console.error('❌ Error in createConversationFromRecord:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }
}

module.exports = new ChatController();