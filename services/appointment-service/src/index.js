// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const connectDB = require('./config/db');

connectDB();
const appointmentRoutes = require('./routes/appointment.route');
const { connectRabbitMQ } = require('./utils/rabbitmq.client');
const setupAppointmentRPC = require('./utils/appointment.rpc');
const cors = require('cors');
// 🔹 load .env


// 🔹 connect MongoDB
const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));

// 🔹 routes
app.use('/api/appointment', appointmentRoutes);

// 🔹 server start
const PORT = process.env.PORT || 3006;

async function startServer() {
  try {
    await connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');

    // Bật RPC consumer
    await setupAppointmentRPC();

    app.listen(PORT, () => {
      console.log(`✅ Appointment service running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start Appointment service:', err);
    process.exit(1);
  }
}

startServer();

