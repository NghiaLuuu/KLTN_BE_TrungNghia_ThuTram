const ChatSession = require('../models/chatSession.model');

class ChatSessionRepository {
  /**
   * Tìm session theo sessionId
   */
  async findBySessionId(sessionId) {
    return await ChatSession.findOne({ sessionId });
  }

  /**
   * Tìm session hoạt động theo userId (lấy mới nhất)
   */
  async findActiveByUserId(userId) {
    return await ChatSession.findOne({ 
      userId, 
      isActive: true 
    }).sort({ createdAt: -1 });
  }

  /**
   * Tạo session mới
   */
  async createSession(userId, sessionId) {
    const session = new ChatSession({
      userId,
      sessionId,
      messages: []
    });
    return await session.save();
  }

  /**
   * Thêm tin nhắn vào session
   */
  async addMessage(sessionId, role, content, imageUrl = null) {
    const message = { 
      role, 
      content, 
      timestamp: new Date() 
    };
    
    // Thêm imageUrl nếu được cung cấp
    if (imageUrl) {
      message.imageUrl = imageUrl;
    }
    
    return await ChatSession.findOneAndUpdate(
      { sessionId },
      {
        $push: {
          messages: message
        }
      },
      { new: true }
    );
  }

  /**
   * Lấy lịch sử chat theo userId
   */
  async getHistory(userId, limit = 50) {
    const session = await ChatSession.findOne({ userId, isActive: true })
      .sort({ createdAt: -1 })
      .select('messages');
    
    if (!session) return [];
    
    // Trả về N tin nhắn cuối cùng
    return session.messages.slice(-limit);
  }

  /**
   * Xóa/vô hiệu hóa session
   */
  async deactivateSession(sessionId) {
    return await ChatSession.findOneAndUpdate(
      { sessionId },
      { isActive: false },
      { new: true }
    );
  }

  /**
   * Lấy hoặc tạo session cho user
   */
  async getOrCreateSession(userId) {
    let session = await this.findActiveByUserId(userId);
    
    if (!session) {
      const sessionId = `session_${userId}_${Date.now()}`;
      session = await this.createSession(userId, sessionId);
    }
    
    return session;
  }

  /**
   * Cập nhật booking context
   */
  async updateBookingContext(sessionId, contextUpdate) {
    return await ChatSession.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          'bookingContext': {
            ...contextUpdate,
            lastUpdated: new Date()
          }
        }
      },
      { new: true }
    );
  }

  /**
   * Lấy booking context
   */
  async getBookingContext(sessionId) {
    const session = await ChatSession.findOne({ sessionId }).select('bookingContext');
    return session?.bookingContext || null;
  }

  /**
   * Xóa booking context
   */
  async clearBookingContext(sessionId) {
    return await ChatSession.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          'bookingContext': {
            isInBookingFlow: false,
            selectedService: null,
            selectedServiceAddOn: null,
            selectedDentist: null,
            selectedDate: null,
            selectedSlot: null,
            step: null,
            lastUpdated: null
          }
        }
      },
      { new: true }
    );
  }
}

module.exports = new ChatSessionRepository();
