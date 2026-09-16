const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
require('dotenv').config();

// Execute Database Connection
const connectDB = require('./config/db');
connectDB();

const app = express();

// ---------------------------------------------------------------- Config
const PORT = process.env.PORT || 8007;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://lms1.wehear.in';

// ---------------------------------------------------------------- Middleware
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ---------------------------------------------------------------- Routes
app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/userRoutes'));
app.use('/', require('./routes/categoryRoutes'));
app.use('/', require('./routes/assetRoutes'));
app.use('/', require('./routes/requestRoutes'));

// Health Check Route
app.get('/', (req, res) => res.json({ service: 'Fort Knox EDMS API', status: 'ok', version: 2 }));

// Global Error Handler
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Request failed.' });
  next();
});

// ---------------------------------------------------------------- Execute Seed & Listen
mongoose.connection.once('open', async () => {
  const seed = require('./utils/seed');
  await seed();

  if (require.main === module) {
    app.listen(PORT, () => console.log(`[API] Fort Knox EDMS v2 running on http://localhost:${PORT}`));
  }
});

module.exports = { app };