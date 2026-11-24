/**
 * Settings API
 * Read/write runtime settings (non-secret config)
 * Secrets (token) stay in .env only
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const router = express.Router();

const SETTINGS_FILE = path.join(__dirname, '../config/settings.json');

function loadSettings() {
  const defaults = {
    ha_url: process.env.HA_URL || '',
    camera_device: process.env.CAMERA_DEVICE || '/dev/video0',
    camera_stream_port: process.env.CAMERA_STREAM_PORT || '8081',
    dashboard_name: 'My Smart Home',
    theme: 'dark',
    refresh_interval: 5000,
  };
  if (!fs.existsSync(SETTINGS_FILE)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // Never save token to settings file
  const { ha_token, ...safe } = settings;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(safe, null, 2));
}

function getPiInfo() {
  const info = { hostname: 'unknown', model: 'unknown', uptime: 'unknown', temperature: null };
  try { info.hostname = execSync('hostname', { timeout: 1000 }).toString().trim(); } catch {}
  try { info.model = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim(); } catch {}
  try {
    const up = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
    info.uptime = `${h}h ${m}m`;
  } catch {}
  try {
    const temp = execSync('vcgencmd measure_temp 2>/dev/null', { timeout: 1000 }).toString();
    info.temperature = temp.replace('temp=', '').trim();
  } catch {}
  return info;
}

// GET /api/settings
router.get('/', (req, res) => {
  const settings = loadSettings();
  // Never expose token in settings response
  res.json({ ...settings, ha_token_set: !!(process.env.HA_TOKEN) });
});

// PATCH /api/settings
router.patch('/', (req, res) => {
  const current = loadSettings();
  const updated = { ...current, ...req.body };
  saveSettings(updated);
  res.json({ success: true, settings: updated });
});

// GET /api/settings/system — Pi system info
router.get('/system', (req, res) => {
  res.json(getPiInfo());
});

// GET /api/settings/export — Export config backup
router.get('/export', (req, res) => {
  const settings = loadSettings();
  const automationsFile = path.join(__dirname, '../config/automations.json');
  const automations = fs.existsSync(automationsFile)
    ? JSON.parse(fs.readFileSync(automationsFile, 'utf8'))
    : [];

  const backup = {
    exported_at: new Date().toISOString(),
    settings,
    automations,
  };

  res.setHeader('Content-Disposition', 'attachment; filename="ha-dashboard-backup.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

module.exports = router;
