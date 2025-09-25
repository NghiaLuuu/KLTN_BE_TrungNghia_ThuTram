const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const scheduleRoutes = require('./routes/schedule.route');
const slotRoutes = require('./routes/slot.route');
const scheduleConfigRoutes = require('./routes/scheduleConfig.route');
const autoScheduleRoutes = require('./routes/autoSchedule.route');
const startRpcServer = require('./utils/rpcServer');
const CronJobManager = require('./utils/cronJobs');
const cors = require('cors');

dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));
// Routes
app.use('/api/schedule', scheduleRoutes);
app.use('/api/slot', slotRoutes);
app.use('/api/schedule/config', scheduleConfigRoutes);
app.use('/api/auto-schedule', autoScheduleRoutes);

startRpcServer();

// Initialize cron jobs for auto-schedule
CronJobManager.init();

// Server


const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`Schedule service running on port ${PORT}`);
});
