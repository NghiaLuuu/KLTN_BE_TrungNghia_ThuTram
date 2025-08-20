const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const paymentleRoutes = require('./routes/payment.route');

const startRpcServer = require('./utils/rpcServer');
dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Routes
app.use('/api/payment', paymentleRoutes);


startRpcServer();
// Server


const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`Payment service running on port ${PORT}`);
});
