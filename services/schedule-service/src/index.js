const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const scheduleRoutes = require('./routes/schedule.route');
const slotRoutes = require('./routes/slot.route');

dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Routes
app.use('/api/schedule', scheduleRoutes);
app.use('/api/slot', slotRoutes);
// Server
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`Schedule service running on port ${PORT}`);
});
