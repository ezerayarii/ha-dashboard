/**
 * Camera API — Multi-platform detection
 * Works on: Raspberry Pi (v4l2), Windows (DirectShow), macOS, and shows manual config
 */

const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const router = express.Router();

const platform = process.platform; // 'linux', 'win32', 'darwin'

function detectCameras() {
  const cameras = [];

  // ── Linux / Raspberry Pi ──────────────────────────────────────────
  if (platform === 'linux') {
    try {
      const devices = fs.readdirSync('/dev').filter(f => /^video\d+$/.test(f)).sort();
      for (const dev of devices) {
        const devicePath = `/dev/${dev}`;
        let name = dev;
        let isLogitech = false;

        // Try v4l2-ctl for device name
        try {
          const info = execSync(`v4l2-ctl --device=${devicePath} --info 2>/dev/null`, { timeout: 2000 }).toString();
          const m = info.match(/Card type\s*:\s*(.+)/);
          if (m) name = m[1].trim();
        } catch { /* v4l2-ctl not installed */ }

        isLogitech = name.toLowerCase().includes('logi') ||
                     name.toLowerCase().includes('meetup') ||
                     name.toLowerCase().includes('brio') ||
                     name.toLowerCase().includes('c9') ||
                     name.toLowerCase().includes('c1');

        cameras.push({ device: devicePath, name, isLogitech, available: true, platform: 'linux' });
      }
    } catch { /* /dev not readable */ }

    // Also check lsusb for Logitech even if /dev/video not found
    if (cameras.length === 0) {
      try {
        const usb = execSync('lsusb 2>/dev/null', { timeout: 2000 }).toString();
        const lines = usb.split('\n').filter(l => l.toLowerCase().includes('logitech'));
        for (const line of lines) {
          const m = line.match(/ID \w+:\w+ (.+)/);
          const name = m ? m[1].trim() : 'Logitech USB Camera';
          cameras.push({
            device: process.env.CAMERA_DEVICE || '/dev/video0',
            name,
            isLogitech: true,
            available: true,
            platform: 'linux',
            detectedViaUSB: true,
          });
        }
      } catch { /* lsusb not available */ }
    }
  }

  // ── Windows ───────────────────────────────────────────────────────
  if (platform === 'win32') {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "Get-PnpDevice -Class Camera,Image | Where Status -eq OK | Select-Object Name,DeviceID | ConvertTo-Json"',
        { timeout: 5000 }
      ).toString().trim();

      if (out && out !== 'null') {
        const raw = JSON.parse(out);
        const items = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
          const name = item.Name || 'Unknown Camera';
          cameras.push({
            device: item.DeviceID || 'DirectShow',
            name,
            isLogitech: name.toLowerCase().includes('logi') || name.toLowerCase().includes('meetup'),
            available: true,
            platform: 'win32',
          });
        }
      }
    } catch { /* powershell failed */ }

    // Fallback: check WMI
    if (cameras.length === 0) {
      try {
        const out = execSync(
          'wmic path Win32_PnPEntity where "PNPClass=\'Camera\' OR PNPClass=\'Image\'" get Name /value 2>NUL',
          { timeout: 4000 }
        ).toString();
        const names = out.match(/Name=(.+)/g);
        if (names) {
          for (const n of names) {
            const name = n.replace('Name=', '').trim();
            if (name) cameras.push({
              device: 'DirectShow',
              name,
              isLogitech: name.toLowerCase().includes('logi'),
              available: true,
              platform: 'win32',
            });
          }
        }
      } catch { /* wmic not available */ }
    }
  }

  // ── macOS ─────────────────────────────────────────────────────────
  if (platform === 'darwin') {
    try {
      const out = execSync(
        'system_profiler SPCameraDataType 2>/dev/null',
        { timeout: 4000 }
      ).toString();
      const names = out.match(/^    (.+):$/gm);
      if (names) {
        for (const n of names) {
          const name = n.trim().replace(/:$/, '');
          cameras.push({
            device: 'AVCapture',
            name,
            isLogitech: name.toLowerCase().includes('logi') || name.toLowerCase().includes('meetup'),
            available: true,
            platform: 'darwin',
          });
        }
      }
    } catch { /* system_profiler failed */ }
  }

  return cameras;
}

function checkMjpegStreamer(port) {
  try {
    execSync(`curl -s --max-time 1 http://localhost:${port}/ > /dev/null 2>&1`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// GET /api/camera/status
router.get('/status', (req, res) => {
  try {
    const cameras = detectCameras();
    const primary = cameras.find(c => c.available) || null;
    const streamPort = process.env.CAMERA_STREAM_PORT || 8081;
    const mjpegAvailable = primary && platform === 'linux' ? checkMjpegStreamer(streamPort) : false;

    res.json({
      connected: cameras.length > 0,
      cameras,
      primary,
      platform,
      streamPort,
      streamUrl: mjpegAvailable ? `http://${req.hostname}:${streamPort}` : null,
      mjpegAvailable,
      configuredDevice: process.env.CAMERA_DEVICE || null,
    });
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message, platform });
  }
});

module.exports = router;
