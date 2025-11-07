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

    // Join room for specific queue updates (legacy)
    socket.on('join_queue', (roomId) => {
      socket.join(`queue_${roomId}`);
      console.log(`👤 Client ${socket.id} joined queue room: ${roomId}`);
    });

    // Join room with date (new format: room:roomId:date)
    socket.on('join:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.join(roomKey);
      console.log(`🚪 Socket ${socket.id} joined ${roomKey}`);
    });

    // Leave queue room (legacy)
    socket.on('leave_queue', (roomId) => {
      socket.leave(`queue_${roomId}`);
      console.log(`👋 Client ${socket.id} left queue room: ${roomId}`);
    });

    // Leave room with date
    socket.on('leave:room', (data) => {
      const { roomId, date } = data;
      const roomKey = `room:${roomId}:${date}`;
      socket.leave(roomKey);
      console.log(`🚪 Socket ${socket.id} left ${roomKey}`);
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

/**
 * Emit event to specific room
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
  
  console.log(`📤 [Appointment Socket] Emitted ${event} to ${roomKey}:`, data);
}

/**
 * Emit appointment status change
 * When appointment status changes (from record events), notify the queue dashboard
 */
function emitAppointmentStatusChange(appointment) {
  if (!appointment || !appointment.roomId || !appointment.date) {
    console.warn('⚠️ Missing roomId or date in appointment, skipping emit');
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
 * Emit appointment update
 * General appointment update (create, modify, etc.)
 */
function emitAppointmentUpdate(appointment, message) {
  if (!appointment || !appointment.roomId || !appointment.date) {
    console.warn('⚠️ Missing roomId or date in appointment, skipping emit');
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
 * Emit queue update
 * Notify all clients in the room that queue has changed
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
