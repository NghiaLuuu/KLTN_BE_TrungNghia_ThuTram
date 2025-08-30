const dotenv = require('dotenv');
// ✅ Load .env ngay từ đầu
const cors = require('cors');
dotenv.config();

const express = require('express');
const connectDB = require('./config/db');
const invoiceRoutes = require('./routes/invoice.routes');
const invoiceDetailRoutes = require('./routes/invoiceDetail.routes');
const startRpcServer = require('./utils/rpcServer');

// ✅ Kết nối DB
connectDB();

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use('/api/invoice', invoiceRoutes);
app.use('/api/invoiceDetail', invoiceDetailRoutes);


// ✅ RPC Server
startRpcServer();

// ✅ Server listen
const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
  console.log(`🚀 Invoice service running on port ${PORT}`);
});
