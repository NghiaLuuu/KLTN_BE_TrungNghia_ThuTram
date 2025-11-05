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
  async addMessage(sessionId, role, content) {
    return await ChatSession.findOneAndUpdate(
      { sessionId },
      {
        $push: {
          messages: { role, content, timestamp: new Date() }
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
}

module.exports = new ChatSessionRepository();
