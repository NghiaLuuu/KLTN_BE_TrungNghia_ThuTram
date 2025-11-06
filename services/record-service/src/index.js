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
const redis = require('./utils/redis.client');

connectDB();

// ✅ Clear Redis cache on startup
async function clearRecordCacheOnStartup() {
  try {
    // Wait for Redis to be ready
    if (!redis.isReady) {
      console.log('⏳ Waiting for Redis connection...');
      await new Promise((resolve) => {
        redis.once('ready', resolve);
      });
    }
    
    const pattern = 'records:*';
    const deletedCount = await redis.delPattern(pattern);
    console.log(`✅ Cleared ${deletedCount} record cache keys on startup`);
  } catch (error) {
    console.warn('⚠️ Failed to clear record cache on startup:', error.message);
  }
}

// Clear cache after a short delay to ensure Redis is connected
setTimeout(() => {
  clearRecordCacheOnStartup();
}, 2000);

// ✅ Kết nối DB
const app = express();
const server = http.createServer(app);

// ✅ Initialize Socket.IO
initializeSocket(server);

app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
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


