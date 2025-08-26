const dotenv = require('dotenv');
// ✅ Load .env ngay từ đầu
dotenv.config();

const express = require('express');
const connectDB = require('./config/db');
const recordRoutes = require('./routes/record.routes');

const startRpcServer = require('./utils/rpcServer');

// ✅ Kết nối DB
connectDB();

const app = express();
app.use(express.json());
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
