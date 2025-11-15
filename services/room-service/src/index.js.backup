// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const connectDB = require('./config/db');
const roomRoutes = require('./routes/room.route');
const cors = require('cors');
const startRpcServer = require('./utils/room.rpc');
const { startScheduleConsumer } = require('./utils/scheduleConsumer');

connectDB();

// Start RabbitMQ RPC server
startRpcServer().catch(console.error);

// Start RabbitMQ consumer for schedule updates
startScheduleConsumer().catch(console.error);

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));

// Routes
app.use('/api/room', roomRoutes);

// Server
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Room service running on port ${PORT}`);
});

