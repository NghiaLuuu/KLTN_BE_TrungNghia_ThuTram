// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
// ✅ Load .env ngay từ đầu
const cors = require('cors');


const express = require('express');
const connectDB = require('./config/db');

connectDB();
const medicineRoutes = require('./routes/medicine.routes');


// ✅ Kết nối DB
const app = express();
app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000'
    ].filter(Boolean).flatMap(o => o.split(',').map(s => s.trim())).filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/medicine', medicineRoutes);


// ✅ Server listen
const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`🚀 Medicine service running on port ${PORT}`);
});

