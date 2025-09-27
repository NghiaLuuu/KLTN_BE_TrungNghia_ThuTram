// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
// ✅ Load .env ngay từ đầu
const cors = require('cors');


const express = require('express');
const connectDB = require('./config/db');
const recordRoutes = require('./routes/record.routes');

const startRpcServer = require('./utils/rpcServer');

connectDB();

// ✅ Kết nối DB
const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/record', recordRoutes);



// ✅ RPC Server
startRpcServer();

// ✅ Server listen
const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`🚀 Record service running on port ${PORT}`);
});

