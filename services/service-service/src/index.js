// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const connectDB = require('./config/db');

connectDB();
const serviceRoutes = require('./routes/service.route');
const cors = require('cors');


const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));


// Routes
app.use('/api/service', serviceRoutes);

// Server
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Service service running on port ${PORT}`);
});

