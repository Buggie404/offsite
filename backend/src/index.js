// backend/src/index.js
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const http = require('http');
const app = require('./app');
const { connectDB } = require('./config/db');
const { initSocket } = require('./services/socket.service');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
    });
    // Hourly: move pending purchase points to posted once the refund window ends.
    require('./services/points.service').startPointsPostingJob();
    // Hourly (per minute with SUB_TIME_UNIT=minute): charge due Ritual Box subscriptions.
    require('./services/subscription-charge.service').startSubscriptionChargeJob();
  })
  .catch((error) => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  });