// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
// ✅ Load .env ngay từ đầu
const cors = require('cors');


const express = require('express');
const connectDB = require('./config/db');
const recordRoutes = require('./routes/record.routes');

const startRpcServer = require('./utils/rpcServer');
const { connectRabbitMQ, consumeQueue } = require('./utils/rabbitmq.client');
const { 
  handleAppointmentCheckedIn, 
  handlePatientInfoResponse 
} = require('./utils/eventHandlers');

connectDB();

// ✅ Kết nối DB
const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
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
    
    // Listen for appointment_checked_in events
    await consumeQueue('record_queue', async (message) => {
      if (message.event === 'appointment_checked_in') {
        await handleAppointmentCheckedIn(message);
      }
    });
    
    // Listen for patient info responses (optional, if user-service implements)
    await consumeQueue('record_response_queue', async (message) => {
      if (message.event === 'get_patient_info_response') {
        await handlePatientInfoResponse(message);
      }
    });
    
    console.log('✅ RabbitMQ event listeners started');
  } catch (error) {
    console.error('❌ Failed to start RabbitMQ event listeners:', error);
  }
}

// ✅ RPC Server
startRpcServer();

// ✅ Start event listeners
startEventListeners();

// ✅ Server listen
const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`🚀 Record service running on port ${PORT}`);
});

