const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const shiftRoutes = require('./routes/shift.route');

dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Routes
app.use('/api/shift', shiftRoutes);

// Server
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`Shift service running on port ${PORT}`);
});
