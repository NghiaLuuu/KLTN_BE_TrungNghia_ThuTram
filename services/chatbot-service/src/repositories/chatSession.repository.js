const ChatSession = require('../models/chatSession.model');

class ChatSessionRepository {
  /**
   * Find session by sessionId
   */
  async findBySessionId(sessionId) {
    return await ChatSession.findOne({ sessionId });
  }

  /**
   * Find active session by userId (get most recent)
   */
  async findActiveByUserId(userId) {
    return await ChatSession.findOne({ 
      userId, 
      isActive: true 
    }).sort({ createdAt: -1 });
  }

  /**
   * Create new session
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
   * Add message to session
   */
  async addMessage(sessionId, role, content, imageUrl = null) {
    const message = { 
      role, 
      content, 
      timestamp: new Date() 
    };
    
    // Add imageUrl if provided
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
   * Get chat history by userId
   */
  async getHistory(userId, limit = 50) {
    const session = await ChatSession.findOne({ userId, isActive: true })
      .sort({ createdAt: -1 })
      .select('messages');
    
    if (!session) return [];
    
    // Return last N messages
    return session.messages.slice(-limit);
  }

  /**
   * Clear/deactivate session
   */
  async deactivateSession(sessionId) {
    return await ChatSession.findOneAndUpdate(
      { sessionId },
      { isActive: false },
      { new: true }
    );
  }

  /**
   * Get or create session for user
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
   * Update booking context
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
   * Get booking context
   */
  async getBookingContext(sessionId) {
    const session = await ChatSession.findOne({ sessionId }).select('bookingContext');
    return session?.bookingContext || null;
  }

  /**
   * Clear booking context
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
