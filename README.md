# HA Dashboard

A self-hosted control panel for a Home Assistant smart home, built to run on a Raspberry Pi. A Node.js / Express server
proxies the Home Assistant REST API (so the access token never reaches the browser) and pushes live device states to a
single-page web app over Socket.IO. It adds a plain-English command bar, simple local automation rules and a camera
status page.

![Dashboard screenshot](docs/screenshot-dashboard.png)
<!-- TODO: add screenshots (dashboard, devices, camera, commands, settings) to docs/ -->

## Why I built it

I wanted one fast, local page to control my room (lights, TV box, camera) from any device on my home network,
without exposing my Home Assistant token to the browser, and a place to experiment with turning plain sentences
("movie mode", "turn off the lights") into smart home actions.

## Features

- **Live device states**: the server polls Home Assistant every 5 s and pushes `states_update` events to the browser
  over Socket.IO.
- **Device control**: toggle any entity, or call any Home Assistant service through `POST /api/ha/service`.
- **Device list** filtered by domain (lights, switches, media players, ...).
- **Command bar**: regex rules turn plain-text commands into Home Assistant service calls (lights on / off / dim,
  TV on / off, movie mode, night mode, morning mode, open camera, status).
- **Local automation rules**: create, enable / disable, rename and delete named rules (stored as JSON); Home Assistant's
  own automations are listed and can be triggered.
- **Camera status**: detects USB cameras on Linux (v4l2 / `lsusb`, e.g. a Logitech MeetUp), Windows (PnP / WMI) and
  macOS; a helper script starts an MJPEG stream (mjpg-streamer, or ffmpeg as a fallback).
- **Settings page**: Home Assistant URL, camera device and port, refresh rate, theme (non-secret settings only; the
  token stays in `.env`).
- **Runs as a service** on the Pi with the included systemd unit.

## Tech stack

| Part | Tech |
|---|---|
| Server | Node.js, Express 4, Socket.IO 4, Axios, dotenv, CORS |
| Front end | Vanilla JavaScript single-page app (hash router), HTML, CSS |
| Smart home | Home Assistant REST API (long-lived access token) |
| Camera | v4l2 / mjpg-streamer or ffmpeg (Bash script) |
| Deployment | Raspberry Pi, systemd service |

## How it works

```
Browser (SPA) ──HTTP──> Express ──REST (Bearer token)──> Home Assistant
      ^                    │
      └──Socket.IO <───────┘  polls /api/states every 5 s, emits states_update
```

- `server.js`: Express app, static files, the API routes and the Socket.IO polling loop.
- `api/homeassistant.js`: HA client (status, states, entities by domain, services, toggle, automations).
- `api/commands.js`: the command rules (regex -> one or more HA service calls).
- `api/automations.js`: local rules stored in `config/automations.json`.
- `api/settings.js`: non-secret settings in `config/settings.json`.
- `api/camera.js`: camera detection per platform and the MJPEG stream check.
- `public/`: the single-page app (`index.html`, `js/app.js`, `css/style.css`).

## Run it

Requirements: Node.js 18+, a Home Assistant instance and a long-lived access token
(Home Assistant: Profile -> Security -> Long-lived access tokens).

```bash
git clone https://github.com/<your-username>/ha-dashboard.git
cd ha-dashboard
npm install
cp .env.example .env      # then put your HA_URL and HA_TOKEN in .env
npm start                 # http://localhost:3000  (npm run dev: auto-restart with nodemon)
```

On a Raspberry Pi, to start it at boot (edit the user and paths in `ha-dashboard.service` first):

```bash
npm run install-service
```

Camera stream (Linux): `bash scripts/start-camera-stream.sh` (uses `CAMERA_DEVICE` and `CAMERA_STREAM_PORT`).

## Status

**Working**
- The server starts, serves the app and answers its API (health, HA status, states, entities, services, toggle,
  commands, settings, local rules).
- Live state updates over Socket.IO.
- The regex command bar and the camera detection.

**In progress / not done yet**
- Triggering a **local** automation rule only records the time; it doesn't run the rule's actions yet.
- The camera page shows status and the MJPEG stream URL; the stream itself depends on the external script.
- **No login**: the dashboard is meant for a trusted home network (or a VPN such as Tailscale); don't expose it to the
  internet.
- No automated tests.

## Security

- The Home Assistant token is read from `.env` only (never stored in settings files or sent to the browser).
- `.env` and the app's runtime data (`config/`) are git-ignored; `.env.example` shows what's needed.

## Credits

Built with AI coding tools.

## License

MIT, see [LICENSE](LICENSE).
