const socketIO = require('socket.io');

let io = null;

/**
 * Initialize Socket.IO
 * @param {Object} server - HTTP server instance
 */
function initializeSocket(server) {
  io = socketIO(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ Socket client connected: ${socket.id}`);

    // Join room for specific queue updates
    socket.on('join_queue', (roomId) => {
      socket.join(`queue_${roomId}`);
      console.log(`👤 Client ${socket.id} joined queue room: ${roomId}`);
    });

    // Leave queue room
    socket.on('leave_queue', (roomId) => {
      socket.leave(`queue_${roomId}`);
      console.log(`👋 Client ${socket.id} left queue room: ${roomId}`);
    });

    socket.on('disconnect', () => {
      console.log(`❌ Socket client disconnected: ${socket.id}`);
    });
  });

  console.log('🔌 Socket.IO initialized for appointment service');
  return io;
}

/**
 * Get Socket.IO instance
 * @returns {Object} Socket.IO instance
 */
function getIO() {
  if (!io) {
    console.warn('⚠️ Socket.IO not initialized yet');
  }
  return io;
}

module.exports = {
  initializeSocket,
  getIO
};
