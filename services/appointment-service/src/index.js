const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const appointmentRoutes = require('./routes/appointment.route');
const { connectRabbitMQ } = require('./utils/rabbitmq.client');

dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Routes
app.use('/api/appointment', appointmentRoutes);

async function startServer() {
  await connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');

  app.listen(PORT, () => {
    console.log(`Appointment service running on port ${PORT}`);
  });
}

startServer().catch(err => console.error(err));

// Server
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Appointment service running on port ${PORT}`);
});
