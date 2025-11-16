// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
// ✅ Load .env ngay từ đầu - Restart to apply RabbitMQ fixes
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

// ✅ Initialize Socket.IO
initializeSocket(server);

app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000'
    ].filter(Boolean).flatMap(o => o.split(',').map(s => s.trim())).filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/record', recordRoutes);

// ✅ RabbitMQ Event Listeners
async function startEventListeners() {
  try {
    const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    await connectRabbitMQ(RABBITMQ_URL);
    
    console.log('📋 Initializing RabbitMQ queues...');
    
    // Listen for appointment_checked-in events
    await consumeQueue('record_queue', async (message) => {
      if (message.event === 'appointment_checked-in') {
        await handleAppointmentCheckedIn(message);
      } else if (message.event === 'appointment.service_booked') {
        // 🆕 Handle appointment.service_booked from appointment-service
        // Mark treatmentIndications[x].used = true
        const { handleAppointmentServiceBooked } = require('./utils/eventHandlers');
        await handleAppointmentServiceBooked(message);
      } else if (message.event === 'appointment.status_changed') {
        // 🔥 NEW: Handle appointment status changes from appointment-service
        // Emit socket to notify queue dashboard
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
        // Update record with invoiceId when invoice is created
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
    
    // Listen for patient info responses (optional, if user-service implements)
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
    // Don't crash the service if RabbitMQ fails
    console.log('⚠️  Service will continue without RabbitMQ listeners');
  }
}

// ✅ RPC Server
startRpcServer();

// ✅ Start event listeners
startEventListeners();

// ✅ Server listen
const PORT = process.env.PORT || 3010;
server.listen(PORT, () => {
  console.log(`🚀 Record service running on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for connections`);
});


