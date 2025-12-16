const socketIO = require('socket.io');

let io = null;

/**
 * Khởi tạo Socket.IO
 * @param {Object} server - Instance HTTP server
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
    console.log(`✅ Socket client kết nối: ${socket.id}`);

    // Tham gia room cho cập nhật hàng đợi cụ thể (legacy)
    socket.on('join_queue', (roomId) => {
      socket.join(`queue_${roomId}`);
      console.log(`👤 Client ${socket.id} tham gia room hàng đợi: ${roomId}`);
    });

    // Tham gia room với ngày (định dạng mới: room:roomId:date)
    socket.on('join:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.join(roomKey);
      console.log(`🚪 Socket ${socket.id} tham gia ${roomKey}`);
    });

    // Rời room hàng đợi (legacy)
    socket.on('leave_queue', (roomId) => {
      socket.leave(`queue_${roomId}`);
      console.log(`👋 Client ${socket.id} rời room hàng đợi: ${roomId}`);
    });

    // Rời room với ngày
    socket.on('leave:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.leave(roomKey);
      console.log(`🚪 Socket ${socket.id} rời ${roomKey}`);
    });

    socket.on('disconnect', () => {
      console.log(`❌ Socket client ngắt kết nối: ${socket.id}`);
    });
  });

  console.log('🔌 Socket.IO đã khởi tạo cho appointment service');
  return io;
}

/**
 * Lấy instance Socket.IO
 * @returns {Object} Instance Socket.IO
 */
function getIO() {
  if (!io) {
    console.warn('⚠️ Socket.IO chưa được khởi tạo');
  }
  return io;
}

/**
 * Emit sự kiện đến room cụ thể
 * @param {String} roomId - ID phòng khám
 * @param {String} date - Ngày (YYYY-MM-DD)
 * @param {String} event - Tên sự kiện
 * @param {Object} data - Dữ liệu sự kiện
 */
function emitToRoom(roomId, date, event, data) {
  if (!io) {
    console.warn('⚠️ Socket.IO chưa khởi tạo, bỏ qua emit');
    return;
  }
  
  const roomKey = `room:${roomId}:${date}`;
  io.to(roomKey).emit(event, {
    ...data,
    roomId,
    date,
    timestamp: new Date().toISOString()
  });
  
  console.log(`📤 [Appointment Socket] Đã emit ${event} đến ${roomKey}:`, data);
}

/**
 * Emit thay đổi trạng thái lịch hẹn
 * Khi trạng thái lịch hẹn thay đổi (từ record events), thông báo cho queue dashboard
 */
function emitAppointmentStatusChange(appointment) {
  if (!appointment || !appointment.roomId || !appointment.date) {
    console.warn('⚠️ Thiếu roomId hoặc date trong appointment, bỏ qua emit');
    return;
  }
  
  const date = new Date(appointment.date).toISOString().split('T')[0];
  emitToRoom(appointment.roomId, date, 'appointment:status-changed', {
    appointmentId: appointment._id,
    status: appointment.status,
    queueNumber: appointment.queueNumber,
    patientName: appointment.patientInfo?.name || appointment.patientId?.name,
    recordId: appointment.recordId,
    message: `Lịch hẹn ${appointment.queueNumber || ''} đã chuyển sang ${appointment.status}`
  });
}

/**
 * Emit cập nhật lịch hẹn
 * Cập nhật lịch hẹn chung (tạo, sửa, v.v.)
 */
function emitAppointmentUpdate(appointment, message) {
  if (!appointment || !appointment.roomId || !appointment.date) {
    console.warn('⚠️ Thiếu roomId hoặc date trong appointment, bỏ qua emit');
    return;
  }
  
  const date = new Date(appointment.date).toISOString().split('T')[0];
  emitToRoom(appointment.roomId, date, 'appointment:updated', {
    appointmentId: appointment._id,
    patientName: appointment.patientInfo?.name || appointment.patientId?.name,
    queueNumber: appointment.queueNumber,
    status: appointment.status,
    recordId: appointment.recordId,
    message: message || 'Lịch hẹn đã được cập nhật'
  });
}

/**
 * Emit cập nhật hàng đợi
 * Thông báo tất cả clients trong room rằng hàng đợi đã thay đổi
 */
function emitQueueUpdate(roomId, date, message = 'Hàng đợi đã cập nhật') {
  emitToRoom(roomId, date, 'queue:updated', { message });
}

module.exports = {
  initializeSocket,
  getIO,
  emitToRoom,
  emitAppointmentStatusChange,
  emitAppointmentUpdate,
  emitQueueUpdate
};
