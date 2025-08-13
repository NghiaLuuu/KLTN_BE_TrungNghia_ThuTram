const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');
const startRPCServer = require('./utils/user.rpc'); 

dotenv.config();
connectDB();

const app = express();
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// Khởi chạy RPC Server
startRPCServer()
  .then(() => console.log('✅ User RPC server started'))
  .catch(err => console.error('❌ Failed to start User RPC server:', err));

// Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
