const { Server } = require('socket.io');

let io;

/**
 * Khởi tạo máy chủ Socket.IO
 * @param {Object} server - Instance HTTP server
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

    // Tham gia phòng để cập nhật hàng đợi
    socket.on('join:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.join(roomKey);
      console.log(`🚪 Socket ${socket.id} joined ${roomKey}`);
    });

    // Rời phòng
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
 * Lấy instance Socket.IO
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
}

/**
 * Phát cập nhật hồ sơ đến phòng cụ thể
 * @param {String} roomId - ID phòng
 * @param {String} date - Ngày (YYYY-MM-DD)
 * @param {String} event - Tên sự kiện
 * @param {Object} data - Dữ liệu sự kiện
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
  
  // console.log(`📤 Emitted ${event} to ${roomKey}:`, data);
}

/**
 * Phát thay đổi trạng thái hồ sơ
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
 * Phát cập nhật hàng đợi
 */
function emitQueueUpdate(roomId, date, message = 'Hàng đợi đã cập nhật') {
  // console.log('🔔 [emitQueueUpdate] Called with:', { roomId, date, message });
  
  if (!io) {
    console.error('❌ [emitQueueUpdate] Socket.IO not initialized!');
    return;
  }
  
  const roomKey = `room:${roomId}:${date}`;
  const clients = io.sockets.adapter.rooms.get(roomKey);
  // console.log(`👥 [emitQueueUpdate] Clients in ${roomKey}:`, clients ? clients.size : 0);
  
  emitToRoom(roomId, date, 'queue:updated', { message });
}

/**
 * Phát cập nhật hồ sơ
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
