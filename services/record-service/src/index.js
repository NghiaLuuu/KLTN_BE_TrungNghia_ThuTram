// Tải biến môi trường trước tiên
const dotenv = require('dotenv');
dotenv.config();
// ✅ Tải .env ngay từ đầu - Khởi động lại để áp dụng các bản sửa RabbitMQ
const cors = require('cors');
const http = require('http');

const express = require('express');
const connectDB = require('./config/db');
const recordRoutes = require('./routes/record.routes');
const { initializeSocket } = require('./utils/socket');

const startRpcServer = require('./utils/rpcServer');
const { connectRabbitMQ, consumeQueue } = require('./utils/rabbitmq.client');
const { 
  handleAppointmentCheckedIn, 
  handlePatientInfoResponse 
} = require('./utils/eventHandlers');

connectDB();

// ✅ Kết nối DB
const app = express();
const server = http.createServer(app);

// ✅ Khởi tạo Socket.IO
initializeSocket(server);

app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000',
      'https://smilecare.io.vn',
      'https://www.smilecare.io.vn'
    ].filter(Boolean).flatMap(o => o.split(',').map(s => s.trim())).filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('🚫 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires', 'X-Selected-Role']
}));
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/record', recordRoutes);

// ✅ Bộ lắng nghe sự kiện RabbitMQ
async function startEventListeners() {
  try {
    const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    await connectRabbitMQ(RABBITMQ_URL);
    
    console.log('📋 Initializing RabbitMQ queues...');
    
    // Lắng nghe sự kiện appointment_checked-in
    await consumeQueue('record_queue', async (message) => {
      if (message.event === 'appointment_checked-in') {
        await handleAppointmentCheckedIn(message);
      } else if (message.event === 'appointment.service_booked') {
        // 🆕 Xử lý sự kiện appointment.service_booked từ appointment-service
        // Đánh dấu treatmentIndications[x].used = true
        const { handleAppointmentServiceBooked } = require('./utils/eventHandlers');
        await handleAppointmentServiceBooked(message);
      } else if (message.event === 'delete_records_by_appointment') {
        // ⭐ Xử lý sự kiện delete_records_by_appointment từ appointment-service
        // Xóa tất cả hồ sơ liên kết với cuộc hẹn đã hủy
        try {
          const { data } = message;
          const { appointmentId, deletedBy, deletedByRole, reason, deletedAt } = data;
          
          console.log('🔄 [Record Service] Processing delete_records_by_appointment:', {
            appointmentId,
            deletedByRole,
            reason
          });

          const Record = require('./models/record.model');

          // Tìm tất cả hồ sơ cho cuộc hẹn này
          const records = await Record.find({ appointmentId: appointmentId });

          if (records.length === 0) {
            console.log('ℹ️ [Record Service] No records found for appointment:', appointmentId);
            return;
          }

          console.log(`📋 [Record Service] Found ${records.length} record(s) to delete`);

          // Xóa từng hồ sơ
          for (const record of records) {
            await Record.findByIdAndDelete(record._id);
            console.log(`✅ [Record Service] Deleted record: ${record.recordCode} (ID: ${record._id})`);
          }

          console.log(`✅ [Record Service] Successfully deleted ${records.length} record(s) for appointment ${appointmentId}`);

        } catch (error) {
          console.error('❌ [Record Service] Error deleting records:', {
            error: error.message,
            appointmentId: message.data?.appointmentId,
            stack: error.stack
          });
        }
      } else if (message.event === 'appointment.status_changed') {
        // 🔥 MỚI: Xử lý thay đổi trạng thái cuộc hẹn từ appointment-service
        // Phát socket để thông báo dashboard hàng đợi
        try {
          const { data } = message;
          console.log('🔄 [Record Service] Received appointment.status_changed:', JSON.stringify(data, null, 2));
          
          const { emitQueueUpdate } = require('./utils/socket');
          
          if (data.roomId && data.date) {
            const date = typeof data.date === 'string' 
              ? data.date.split('T')[0] 
              : new Date(data.date).toISOString().split('T')[0];
            
            console.log(`📡 [Record Service] About to emit queue update - roomId: ${data.roomId}, date: ${date}`);
            emitQueueUpdate(data.roomId, date, data.message || 'Appointment status updated');
            console.log(`✅ [Record Service] Emitted queue update for appointment status change`);
          } else {
            console.warn('⚠️ [Record Service] Missing roomId or date in appointment.status_changed:', data);
          }
        } catch (error) {
          console.error('❌ Error handling appointment.status_changed:', error);
        }
      } else if (message.event === 'invoice.created') {
        // Cập nhật hồ sơ với invoiceId khi hóa đơn được tạo
        try {
          const { recordId, invoiceId, invoiceCode } = message.data;
          const Record = require('./models/record.model');
          
          console.log('[Record] Updating record with invoiceId:', {
            recordId,
            invoiceId,
            invoiceCode
          });
          
          await Record.findByIdAndUpdate(
            recordId,
            { invoiceId: invoiceId },
            { new: true }
          );
          
          console.log('[Record] Successfully updated record with invoiceId');
        } catch (error) {
          console.error('[Record] Error updating record with invoiceId:', error);
        }
      }
    });
    
    // Lắng nghe phản hồi thông tin bệnh nhân (tùy chọn, nếu user-service triển khai)
    await consumeQueue('record_response_queue', async (message) => {
      if (message.event === 'get_patient_info_response') {
        await handlePatientInfoResponse(message);
      }
    });
    
    console.log('✅ RabbitMQ event listeners started');
    console.log('   - Listening on: record_queue');
    console.log('   - Listening on: record_response_queue');
  } catch (error) {
    console.error('❌ Failed to start RabbitMQ event listeners:', error);
    console.error('Error details:', error.message);
    // Không làm crash dịch vụ nếu RabbitMQ thất bại
    console.log('⚠️  Dịch vụ sẽ tiếp tục mà không có bộ lắng nghe RabbitMQ');
  }
}

// ✅ Máy chủ RPC
startRpcServer();

// ✅ Khởi động bộ lắng nghe sự kiện
startEventListeners();

// ✅ Máy chủ lắng nghe
const PORT = process.env.PORT || 3010;
server.listen(PORT, () => {
  console.log(`🚀 Record service running on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for connections`);
});


