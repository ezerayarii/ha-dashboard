/**
 * HA Dashboard - Smart Home Control Panel
 * Runs locally on Raspberry Pi, proxies Home Assistant API
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const haRoutes = require('./api/homeassistant');
const cameraRoutes = require('./api/camera');
const automationRoutes = require('./api/automations');
const settingsRoutes = require('./api/settings');
const commandRoutes = require('./api/commands');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/ha', haRoutes);
app.use('/api/camera', cameraRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/command', commandRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('subscribe_states', () => {
    // Poll HA for state changes every 5 seconds
    const interval = setInterval(async () => {
      try {
        const states = await require('./api/homeassistant').fetchStates();
        socket.emit('states_update', states);
      } catch (err) {
        socket.emit('error', { message: 'Failed to fetch states' });
      }
    }, 5000);

    socket.on('disconnect', () => {
      clearInterval(interval);
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏠 HA Dashboard running at http://localhost:${PORT}`);
  console.log(`   Access on your network: http://<raspberry-pi-ip>:${PORT}\n`);
});
