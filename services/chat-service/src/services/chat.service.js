const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const { getVietnamTime } = require('../utils/time.util');

class ChatService {
  // Tạo conversation từ record đã hoàn thành
  async createConversationFromRecord(recordData) {
    try {
      // Kiểm tra xem conversation đã tồn tại chưa
      const existingConversation = await Conversation.findOne({
        recordId: recordData.recordId
      });

      if (existingConversation) {
        console.log(`💬 Conversation already exists for record ${recordData.recordId}`);
        return existingConversation;
      }

      // Tạo conversation mới
      const conversation = new Conversation({
        recordId: recordData.recordId,
        doctorId: recordData.doctorId,
        patientId: recordData.patientId,
        doctorInfo: {
          name: recordData.doctorInfo?.name || 'Bác sĩ',
          avatar: recordData.doctorInfo?.avatar,
          specialization: recordData.doctorInfo?.specialization
        },
        patientInfo: {
          name: recordData.patientInfo?.name || 'Bệnh nhân',
          avatar: recordData.patientInfo?.avatar,
          phone: recordData.patientInfo?.phone
        },
        createdAt: getVietnamTime(),
        updatedAt: getVietnamTime()
      });

      const savedConversation = await conversation.save();
      console.log(`✅ Created new conversation for record ${recordData.recordId}`);
      
      return savedConversation;
    } catch (error) {
      console.error('❌ Error creating conversation from record:', error);
      throw error;
    }
  }

  // Lấy danh sách conversations của user
  async getUserConversations(userId, userType) {
    try {
      const filter = userType === 'doctor' 
        ? { doctorId: userId }
        : { patientId: userId };

      const conversations = await Conversation.find({
        ...filter,
        isActive: true
      })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 })
      .lean();

      return conversations;
    } catch (error) {
      console.error('❌ Error getting user conversations:', error);
      throw error;
    }
  }

  // Lấy conversation theo ID
  async getConversationById(conversationId, userId) {
    try {
      const conversation = await Conversation.findOne({
        _id: conversationId,
        $or: [
          { doctorId: userId },
          { patientId: userId }
        ],
        isActive: true
      }).lean();

      if (!conversation) {
        throw new Error('Conversation not found or access denied');
      }

      return conversation;
    } catch (error) {
      console.error('❌ Error getting conversation:', error);
      throw error;
    }
  }

  // Gửi tin nhắn
  async sendMessage(conversationId, senderId, senderType, content, messageType = 'text') {
    try {
      // Kiểm tra conversation tồn tại và user có quyền
      const conversation = await this.getConversationById(conversationId, senderId);

      // Tạo tin nhắn mới
      const message = new Message({
        conversationId,
        senderId,
        senderType,
        content,
        messageType,
        createdAt: getVietnamTime()
      });

      const savedMessage = await message.save();

      // Cập nhật lastMessage và unreadCount trong conversation
      const updateData = {
        lastMessage: {
          content,
          senderId,
          senderType,
          timestamp: getVietnamTime(),
          messageType
        },
        updatedAt: getVietnamTime()
      };

      // Tăng unreadCount cho người nhận
      if (senderType === 'doctor') {
        updateData['unreadCount.patient'] = conversation.unreadCount.patient + 1;
      } else {
        updateData['unreadCount.doctor'] = conversation.unreadCount.doctor + 1;
      }

      await Conversation.findByIdAndUpdate(conversationId, updateData);

      return savedMessage;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      throw error;
    }
  }

  // Lấy tin nhắn trong conversation
  async getMessages(conversationId, userId, page = 1, limit = 50) {
    try {
      // Kiểm tra quyền truy cập
      await this.getConversationById(conversationId, userId);

      const skip = (page - 1) * limit;

      const messages = await Message.find({
        conversationId,
        isDeleted: false
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

      // Đảo ngược để hiển thị theo thứ tự thời gian
      return messages.reverse();
    } catch (error) {
      console.error('❌ Error getting messages:', error);
      throw error;
    }
  }

  // Đánh dấu tin nhắn đã đọc
  async markMessagesAsRead(conversationId, userId, userType) {
    try {
      // Kiểm tra quyền truy cập
      await this.getConversationById(conversationId, userId);

      // Đánh dấu tin nhắn đã đọc
      await Message.updateMany(
        {
          conversationId,
          senderType: { $ne: userType }, // Tin nhắn không phải của mình
          'readBy.userId': { $ne: userId } // Chưa đọc
        },
        {
          $push: {
            readBy: {
              userId,
              userType,
              readAt: getVietnamTime()
            }
          },
          status: 'read'
        }
      );

      // Reset unreadCount cho user này
      const updateField = userType === 'doctor' 
        ? { 'unreadCount.doctor': 0 }
        : { 'unreadCount.patient': 0 };

      await Conversation.findByIdAndUpdate(conversationId, updateField);

      return { success: true };
    } catch (error) {
      console.error('❌ Error marking messages as read:', error);
      throw error;
    }
  }

  // Tìm kiếm conversations
  async searchConversations(userId, userType, query) {
    try {
      const filter = userType === 'doctor' 
        ? { doctorId: userId }
        : { patientId: userId };

      // Tìm kiếm theo tên trong thông tin cached
      const searchField = userType === 'doctor' 
        ? 'patientInfo.name'
        : 'doctorInfo.name';

      const conversations = await Conversation.find({
        ...filter,
        isActive: true,
        [searchField]: { $regex: query, $options: 'i' }
      })
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 })
      .lean();

      return conversations;
    } catch (error) {
      console.error('❌ Error searching conversations:', error);
      throw error;
    }
  }
}

module.exports = new ChatService();