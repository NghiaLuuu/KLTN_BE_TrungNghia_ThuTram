const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { connectRabbitMQ } = require('./utils/rabbitmq.client');
const { setupEventListeners } = require('./utils/eventListeners');
const appointmentRoutes = require('./routes/appointment.route');

connectDB();

const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));

app.use('/api/appointment', appointmentRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'appointment-service' });
});

const PORT = process.env.PORT || 3006;

async function startServer() {
  try {
    await connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');
    console.log('✅ RabbitMQ connected');
    
    await setupEventListeners();
    console.log('✅ Event listeners ready');
    
    app.listen(PORT, () => {
      console.log(`✅ Appointment Service running on port ${PORT}`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
    });
    
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

startServer();
