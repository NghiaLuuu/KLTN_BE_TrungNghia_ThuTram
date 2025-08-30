const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const serviceRoutes = require('./routes/service.route');
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
app.use('/api/service', serviceRoutes);

// Server
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Service service running on port ${PORT}`);
});
