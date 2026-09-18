const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const connectDB = require('./config/db');
connectDB();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://192.168.29.254:3000',
  'https://lms1.wehear.in'
];
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(userId);
  });
});

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

app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/userRoutes'));
app.use('/', require('./routes/categoryRoutes'));
app.use('/', require('./routes/assetRoutes'));
app.use('/', require('./routes/requestRoutes'));
app.use('/', require('./routes/auditRoutes'));

app.get('/', (req, res) => res.json({ service: 'WeHear Central Repository API', status: 'ok', version: 2 }));

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Request failed.' });
  next();
});

mongoose.connection.once('open', async () => {
  if (require.main === module) {
    server.listen(PORT, () => console.log(`[API] WeHear Central Repository v2 running on http://localhost:${PORT}`));
  }
});

module.exports = { app };