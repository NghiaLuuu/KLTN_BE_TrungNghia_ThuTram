const chatService = require('../services/chat.service');
const { authenticateSocket } = require('../middlewares/auth.middleware');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socketId
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use(authenticateSocket);
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔗 User connected: ${socket.user.userId} (${socket.user.role})`);

      // Store user connection
      this.connectedUsers.set(socket.user.userId, socket.id);

      // Join user to their personal room
      socket.join(`user:${socket.user.userId}`);

      // Handle joining conversation room
      socket.on('join_conversation', async (data) => {
        try {
          const { conversationId } = data;
          
          // Verify user has access to this conversation
          await chatService.getConversationById(conversationId, socket.user.userId);
          
          socket.join(`conversation:${conversationId}`);
          
          socket.emit('joined_conversation', {
            success: true,
            conversationId,
            message: 'Joined conversation successfully'
          });

          console.log(`👥 User ${socket.user.userId} joined conversation ${conversationId}`);
        } catch (error) {
          socket.emit('error', {
            success: false,
            message: error.message || 'Failed to join conversation'
          });
        }
      });

      // Handle leaving conversation room
      socket.on('leave_conversation', (data) => {
        const { conversationId } = data;
        socket.leave(`conversation:${conversationId}`);
        
        console.log(`👋 User ${socket.user.userId} left conversation ${conversationId}`);
      });

      // Handle sending message
      socket.on('send_message', async (data) => {
        try {
          const { conversationId, content, messageType = 'text' } = data;
          
          if (!content || content.trim() === '') {
            socket.emit('error', {
              success: false,
              message: 'Message content is required'
            });
            return;
          }

          const userType = ['doctor', 'admin', 'manager'].includes(socket.user.role) 
            ? 'doctor' 
            : 'patient';

          // Send message through service
          const message = await chatService.sendMessage(
            conversationId,
            socket.user.userId,
            userType,
            content.trim(),
            messageType
          );

          // Emit to conversation room
          this.io.to(`conversation:${conversationId}`).emit('new_message', {
            success: true,
            data: message
          });

          // Emit to sender confirmation
          socket.emit('message_sent', {
            success: true,
            data: message
          });

          console.log(`💬 Message sent in conversation ${conversationId} by user ${socket.user.userId}`);
        } catch (error) {
          socket.emit('error', {
            success: false,
            message: error.message || 'Failed to send message'
          });
        }
      });

      // Handle typing indicator
      socket.on('typing_start', (data) => {
        const { conversationId } = data;
        socket.to(`conversation:${conversationId}`).emit('user_typing', {
          userId: socket.user.userId,
          userName: socket.user.fullName || 'User',
          isTyping: true
        });
      });

      socket.on('typing_stop', (data) => {
        const { conversationId } = data;
        socket.to(`conversation:${conversationId}`).emit('user_typing', {
          userId: socket.user.userId,
          userName: socket.user.fullName || 'User',
          isTyping: false
        });
      });

      // Handle mark as read
      socket.on('mark_as_read', async (data) => {
        try {
          const { conversationId } = data;
          
          const userType = ['doctor', 'admin', 'manager'].includes(socket.user.role) 
            ? 'doctor' 
            : 'patient';

          await chatService.markMessagesAsRead(conversationId, socket.user.userId, userType);

          // Notify conversation room that messages were read
          socket.to(`conversation:${conversationId}`).emit('messages_read', {
            userId: socket.user.userId,
            conversationId,
            readAt: new Date()
          });

          socket.emit('marked_as_read', {
            success: true,
            conversationId
          });
        } catch (error) {
          socket.emit('error', {
            success: false,
            message: error.message || 'Failed to mark as read'
          });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.user.userId}`);
        this.connectedUsers.delete(socket.user.userId);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error('❌ Socket error:', error);
      });
    });
  }

  // Utility method to check if user is online
  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }

  // Utility method to send notification to specific user
  sendNotificationToUser(userId, notification) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit('notification', notification);
      return true;
    }
    return false;
  }

  // Send notification about new conversation
  notifyNewConversation(userId, conversationData) {
    this.sendNotificationToUser(userId, {
      type: 'new_conversation',
      data: conversationData,
      message: 'New conversation created'
    });
  }
}

module.exports = SocketHandler;