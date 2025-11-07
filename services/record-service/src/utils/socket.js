const { Server } = require('socket.io');

let io;

/**
 * Initialize Socket.IO server
 * @param {Object} server - HTTP server instance
 */
function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);

    // Join room for queue updates
    socket.on('join:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.join(roomKey);
      console.log(`🚪 Socket ${socket.id} joined ${roomKey}`);
    });

    // Leave room
    socket.on('leave:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.leave(roomKey);
      console.log(`🚪 Socket ${socket.id} left ${roomKey}`);
    });

    socket.on('disconnect', () => {
      console.log('❌ Client disconnected:', socket.id);
    });
  });

  console.log('✅ Socket.IO initialized');
  return io;
}

/**
 * Get Socket.IO instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

/**
 * Emit record update to specific room
 * @param {String} roomId - Room ID
 * @param {String} date - Date (YYYY-MM-DD)
 * @param {String} event - Event name
 * @param {Object} data - Event data
 */
function emitToRoom(roomId, date, event, data) {
  if (!io) {
    console.warn('⚠️ Socket.IO not initialized, skipping emit');
    return;
  }
  
  const roomKey = `room:${roomId}:${date}`;
  io.to(roomKey).emit(event, {
    ...data,
    roomId,
    date,
    timestamp: new Date().toISOString()
  });
  
  console.log(`📤 Emitted ${event} to ${roomKey}:`, data);
}

/**
 * Emit record status change
 */
function emitRecordStatusChange(record) {
  if (!record || !record.roomId || !record.date) return;
  
  const date = new Date(record.date).toISOString().split('T')[0];
  emitToRoom(record.roomId, date, 'record:status-changed', {
    recordId: record._id,
    status: record.status,
    queueNumber: record.queueNumber,
    patientName: record.patientInfo?.name,
    message: `Hồ sơ ${record.queueNumber || ''} đã chuyển sang trạng thái ${record.status}`
  });
}

/**
 * Emit queue update
 */
function emitQueueUpdate(roomId, date, message = 'Hàng đợi đã cập nhật') {
  console.log('🔔 [emitQueueUpdate] Called with:', { roomId, date, message });
  
  if (!io) {
    console.error('❌ [emitQueueUpdate] Socket.IO not initialized!');
    return;
  }
  
  const roomKey = `room:${roomId}:${date}`;
  const clients = io.sockets.adapter.rooms.get(roomKey);
  console.log(`👥 [emitQueueUpdate] Clients in ${roomKey}:`, clients ? clients.size : 0);
  
  emitToRoom(roomId, date, 'queue:updated', { message });
}

/**
 * Emit record update
 */
function emitRecordUpdate(record, message) {
  if (!record || !record.roomId || !record.date) return;
  
  const date = new Date(record.date).toISOString().split('T')[0];
  emitToRoom(record.roomId, date, 'record:updated', {
    recordId: record._id,
    patientName: record.patientInfo?.name,
    queueNumber: record.queueNumber,
    status: record.status,
    message
  });
}

module.exports = {
  initializeSocket,
  getIO,
  emitToRoom,
  emitRecordStatusChange,
  emitQueueUpdate,
  emitRecordUpdate
};
