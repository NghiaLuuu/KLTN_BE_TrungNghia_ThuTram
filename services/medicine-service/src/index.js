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
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/medicine', medicineRoutes);


// ✅ Server listen
const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`🚀 Medicine service running on port ${PORT}`);
});

