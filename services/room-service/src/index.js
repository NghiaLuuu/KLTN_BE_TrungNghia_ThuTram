const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const roomRoutes = require('./routes/room.route');

dotenv.config();
connectDB();

const app = express();
app.use(express.json());

// Routes
app.use('/api/room', roomRoutes);

// Server
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
