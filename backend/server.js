const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
require('dotenv').config();

// Execute Database Connection
const connectDB = require('./config/db');
connectDB();

const app = express();

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://192.168.29.254:3000',
  'https://lms1.wehear.in'
];

// ---------------------------------------------------------------- Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------- Routes
app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/userRoutes'));
app.use('/', require('./routes/categoryRoutes'));
app.use('/', require('./routes/assetRoutes'));
app.use('/', require('./routes/requestRoutes'));
app.use('/', require('./routes/auditRoutes'));

// Health Check Route
app.get('/', (req, res) => res.json({ service: 'Fort Knox EDMS API', status: 'ok', version: 2 }));

// Global Error Handler
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Request failed.' });
  next();
});

// ---------------------------------------------------------------- Execute Listen (Seed Removed)
mongoose.connection.once('open', async () => {
  // THE LEGACY SEED SCRIPT HAS BEEN COMPLETELY REMOVED FROM HERE

  if (require.main === module) {
    app.listen(PORT, () => console.log(`[API] Fort Knox EDMS v2 running on http://localhost:${PORT}`));
  }
});

module.exports = { app };