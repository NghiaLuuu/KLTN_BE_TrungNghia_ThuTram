const dotenv = require('dotenv');
// ✅ Load .env ngay từ đầu
dotenv.config();

const express = require('express');
const connectDB = require('./config/db');
const paymentRoutes = require('./routes/payment.route');
const startRpcServer = require('./utils/rpcServer');

// ✅ Kết nối DB
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/payment', paymentRoutes);

// ✅ RPC Server
startRpcServer();

// ✅ Server listen
const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`🚀 Payment service running on port ${PORT}`);
});
