/**
 * HA Dashboard — Frontend App
 * Single-page app with hash-based routing, WebSocket state sync
 */

'use strict';

const app = (() => {
  // ─── State ─────────────────────────────────────────────────────
  let allDevices = [];
  let settings = {};
  let socket = null;
  let toastTimer = null;
  let clockTimer = null;

  // ─── INIT ───────────────────────────────────────────────────────
  async function init() {
    startClock();
    setupRouter();
    setupSocket();
    await loadSettings();

    // Load initial page
    const hash = location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);
  }

  // ─── CLOCK ──────────────────────────────────────────────────────
  function startClock() {
    const el = document.getElementById('current-time');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  // ─── ROUTER ─────────────────────────────────────────────────────
  function setupRouter() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        navigateTo(page);
        // Close sidebar on mobile
        document.getElementById('sidebar').classList.remove('open');
      });
    });

    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    window.addEventListener('hashchange', () => {
      const page = location.hash.replace('#', '') || 'dashboard';
      navigateTo(page);
    });
  }

  function navigateTo(page) {
    // Update hash
    history.replaceState(null, '', `#${page}`);

    // Update nav
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.page === page);
    });

    // Show page
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Load page data
    switch (page) {
      case 'dashboard': loadDashboard(); break;
      case 'devices':   loadDevices();   break;
      case 'camera':    loadCamera();    break;
      case 'commands':  loadCommands();  break;
      case 'automations': loadAutomations(); break;
      case 'settings':  loadSettingsPage(); break;
    }
  }

  // ─── WEBSOCKET ──────────────────────────────────────────────────
  function setupSocket() {
    if (typeof io === 'undefined') return;
    socket = io();
    socket.on('connect', () => {
      socket.emit('subscribe_states');
    });
    socket.on('states_update', (states) => {
      allDevices = normalizeStates(states);
      refreshDeviceViews();
    });
  }

  // ─── API HELPERS ─────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return res.json();
  }

  async function post(path, body) {
    return api(path, { method: 'POST', body: JSON.stringify(body) });
  }

  async function patch(path, body) {
    return api(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  // ─── SETTINGS ────────────────────────────────────────────────────
  async function loadSettings() {
    try {
      settings = await api('/api/settings');
      const nameEl = document.getElementById('dashboard-name');
      if (nameEl && settings.dashboard_name) nameEl.textContent = settings.dashboard_name;
      document.title = settings.dashboard_name || 'Home Dashboard';
    } catch { /* use defaults */ }
  }

  // ─── DASHBOARD ───────────────────────────────────────────────────
  async function loadDashboard() {
    await Promise.all([
      loadHAStatus(),
      loadDashboardDevices(),
      loadSystemInfo(),
      loadCameraStatus(),
    ]);
  }

  async function loadHAStatus() {
    const dot = document.getElementById('ha-status-dot');
    const label = document.getElementById('ha-status-label');
    const sysEl = document.getElementById('sys-ha');
    try {
      const data = await api('/api/ha/status');
      const online = data.connected;
      dot.className = `status-dot ${online ? 'online' : 'offline'}`;
      label.textContent = online ? `HA ${data.version || 'connected'}` : 'HA offline';
      if (sysEl) sysEl.textContent = online ? '● Online' : '✗ Offline';
      if (sysEl) sysEl.style.color = online ? 'var(--green)' : 'var(--red)';
    } catch {
      dot.className = 'status-dot offline';
      label.textContent = 'HA offline';
      if (sysEl) { sysEl.textContent = '✗ Error'; sysEl.style.color = 'var(--red)'; }
    }
  }

  async function loadDashboardDevices() {
    const container = document.getElementById('dashboard-devices');
    try {
      const entities = await api('/api/ha/entities?domain=light,switch,media_player');
      allDevices = entities;

      if (!entities.length) {
        container.innerHTML = `<div class="empty-state">No devices found. Check your Home Assistant connection in Settings.</div>`;
        return;
      }

      container.innerHTML = entities.slice(0, 12).map(renderDeviceCard).join('');
    } catch (err) {
      container.innerHTML = `<div class="empty-state">Could not load devices.<br><small>${err.message}</small></div>`;
    }
  }

  function renderDeviceCard(entity) {
    const isOn = ['on', 'playing', 'home', 'open', 'locked'].includes(entity.state);
    const stateClass = entity.state === 'on' ? 'state-on'
      : entity.state === 'playing' ? 'state-playing'
      : entity.state === 'off' ? 'state-off'
      : 'state-other';

    return `
      <div class="device-card ${isOn ? 'on' : ''}" onclick="app.toggleEntity('${entity.entity_id}')">
        <div class="device-domain">${entity.domain}</div>
        <div class="device-name" title="${entity.entity_id}">${entity.friendly_name}</div>
        <span class="device-state ${stateClass}">${entity.state}</span>
      </div>`;
  }

  function normalizeStates(states) {
    return states.map(s => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: s.attributes?.friendly_name || s.entity_id,
      domain: s.entity_id.split('.')[0],
      attributes: s.attributes,
      last_changed: s.last_changed,
    }));
  }

  function refreshDeviceViews() {
    // Refresh device grid if dashboard is active
    const dashActive = document.getElementById('page-dashboard')?.classList.contains('active');
    if (dashActive) {
      const container = document.getElementById('dashboard-devices');
      if (container && allDevices.length) {
        const filtered = allDevices.filter(e =>
          ['light', 'switch', 'media_player'].includes(e.domain)
        ).slice(0, 12);
        container.innerHTML = filtered.map(renderDeviceCard).join('');
      }
    }

    // Refresh devices list if on devices page
    const devicesActive = document.getElementById('page-devices')?.classList.contains('active');
    if (devicesActive) renderDeviceList(allDevices);
  }

  async function loadSystemInfo() {
    try {
      const data = await api('/api/settings/system');
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
      set('sys-uptime', data.uptime);
      set('sys-temp', data.temperature);
    } catch { /* non-Pi env */ }
  }

  async function loadCameraStatus() {
    try {
      const data = await api('/api/camera/status');
      const el = document.getElementById('sys-camera');
      if (el) {
        el.textContent = data.connected ? '● Connected' : '○ None';
        el.style.color = data.connected ? 'var(--green)' : 'var(--text-muted)';
      }
    } catch { /* ignore */ }
  }

  // ─── DEVICES PAGE ────────────────────────────────────────────────
  async function loadDevices() {
    const container = document.getElementById('devices-list');
    container.innerHTML = '<div class="loading-placeholder">Loading…</div>';
    try {
      const entities = await api('/api/ha/entities');
      allDevices = entities;
      renderDeviceList(entities);
    } catch (err) {
      container.innerHTML = `<div class="empty-state">${err.message}</div>`;
    }
  }

  function renderDeviceList(entities) {
    const filter = document.getElementById('domain-filter')?.value || 'all';
    const filtered = filter === 'all' ? entities : entities.filter(e => e.domain === filter);
    const container = document.getElementById('devices-list');
    if (!container) return;

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state">No devices found.</div>';
      return;
    }

    const controllable = ['light', 'switch', 'media_player', 'input_boolean', 'fan', 'cover'];

    container.innerHTML = filtered.map(entity => {
      const canToggle = controllable.includes(entity.domain);
      const isOn = entity.state === 'on' || entity.state === 'playing';
      const stateClass = entity.state === 'on' ? 'state-on'
        : entity.state === 'playing' ? 'state-playing'
        : entity.state === 'off' ? 'state-off'
        : 'state-other';

      return `
        <div class="device-row">
          <div class="device-row-left">
            <div>
              <div class="device-row-name">${entity.friendly_name}</div>
              <div class="device-row-id mono">${entity.entity_id}</div>
            </div>
          </div>
          <div class="device-row-right">
            <span class="device-state ${stateClass}">${entity.state}</span>
            ${canToggle ? `
              <label class="toggle">
                <input type="checkbox" ${isOn ? 'checked' : ''}
                  onchange="app.toggleEntity('${entity.entity_id}')">
                <span class="toggle-slider"></span>
              </label>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function filterDevices(domain) {
    renderDeviceList(allDevices);
  }

  // ─── TOGGLE / CONTROL ────────────────────────────────────────────
  async function toggleEntity(entity_id) {
    try {
      await api(`/api/ha/toggle/${entity_id}`, { method: 'POST' });
      toast(`Toggled ${entity_id.split('.')[1]}`, 'success');
      // Refresh after short delay
      setTimeout(() => {
        const page = location.hash.replace('#', '') || 'dashboard';
        if (page === 'dashboard') loadDashboardDevices();
        else if (page === 'devices') loadDevices();
      }, 800);
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
    }
  }

  // ─── QUICK ACTIONS ───────────────────────────────────────────────
  async function quickAction(action) {
    const ACTIONS = {
      lights_on:  { text: 'turn on lights' },
      lights_off: { text: 'turn off lights' },
      tv_on:      { text: 'turn on tv' },
      tv_off:     { text: 'turn off tv' },
      night_mode: { text: 'night mode' },
      movie_mode: { text: 'movie mode' },
    };

    const cmd = ACTIONS[action];
    if (!cmd) return;

    try {
      const result = await post('/api/command', { text: cmd.text });
      toast(result.message || cmd.text, result.success ? 'success' : 'error');
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
    }
  }

  // ─── CAMERA ──────────────────────────────────────────────────────
  function camTab(name, btn) {
    document.querySelectorAll('.cam-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cam-panel').forEach(p => p.style.display = 'none');
    if (btn) btn.classList.add('active');
    const panel = document.getElementById(`cam-panel-${name}`);
    if (panel) panel.style.display = 'block';
  }

  async function loadCamera() {
    const statusCard = document.getElementById('camera-status-card');
    const viewer = document.getElementById('camera-viewer');
    const infoEl = document.getElementById('camera-info');

    statusCard.innerHTML = '<div class="loading-placeholder">Scanning for cameras…</div>';

    // Load saved URLs into setup tab
    const savedStream = localStorage.getItem('cam_stream_url') || '';
    const savedSnapshot = localStorage.getItem('cam_snapshot_url') || '';
    const streamInput = document.getElementById('cam-stream-url');
    const snapshotInput = document.getElementById('cam-snapshot-url');
    if (streamInput && savedStream) streamInput.value = savedStream;
    if (snapshotInput && savedSnapshot) snapshotInput.value = savedSnapshot;

    let data;
    try {
      data = await api('/api/camera/status');
    } catch (err) {
      statusCard.innerHTML = `<div class="empty-state">API error: ${err.message}</div>`;
      return;
    }

    const primary = data.primary;
    const isOnPi = data.platform === 'linux';
    const platformLabel = { linux: 'Linux / Raspberry Pi', win32: 'Windows', darwin: 'macOS' }[data.platform] || data.platform;

    // ── Status card ────────────────────────────────────────────────
    statusCard.innerHTML = `
      <div style="display:flex; align-items:center; gap:.75rem; flex-wrap:wrap">
        <span class="camera-badge ${data.connected ? 'connected' : 'disconnected'}">
          ${data.connected ? '● Camera Detected' : '○ No Camera Found'}
        </span>
        <span style="font-size:.78rem; color:var(--text-muted)">Running on: ${platformLabel}</span>
        ${savedStream ? '<span class="camera-badge connected">● Stream Configured</span>' : ''}
        ${data.mjpegAvailable ? '<span class="camera-badge connected">● Stream Live</span>' : ''}
        ${!isOnPi ? '<span style="font-size:.78rem; color:var(--amber); padding:.2rem .5rem; background:var(--amber-dim); border-radius:4px">Deploy to Pi for live camera</span>' : ''}
      </div>
      ${primary ? `<p style="margin-top:.65rem; font-size:.85rem; color:var(--text-secondary)">
        Found: <strong>${primary.name}</strong>
        <span class="mono" style="color:var(--text-muted); font-size:.78rem; margin-left:.5rem">${primary.device}</span>
        ${primary.isLogitech ? '<span style="color:var(--accent); margin-left:.4rem; font-size:.78rem">✓ Logitech</span>' : ''}
      </p>` : ''}
    `;

    // ── Stream viewer ──────────────────────────────────────────────
    // Priority: 1. auto-detected mjpeg stream, 2. saved manual URL, 3. placeholder
    const streamUrl = data.mjpegAvailable ? data.streamUrl
                    : savedStream ? savedStream
                    : null;

    if (streamUrl) {
      viewer.innerHTML = `
        <div style="position:relative; width:100%">
          <img
            src="${streamUrl}"
            alt="Camera stream"
            style="width:100%; max-width:900px; border-radius:8px; display:block; margin:0 auto"
            onerror="document.getElementById('camera-viewer').innerHTML = app.cameraError('${streamUrl}')"
          />
          <div style="position:absolute; top:.6rem; right:.6rem; display:flex; gap:.4rem">
            <span style="background:var(--green); color:white; font-size:.7rem; padding:.2rem .5rem; border-radius:4px; font-weight:600">LIVE</span>
            <button class="btn btn-ghost btn-sm" onclick="app.loadCamera()">↻</button>
          </div>
        </div>`;
    } else {
      viewer.innerHTML = `
        <div class="camera-placeholder" style="padding:3rem 2rem">
          <div class="cam-icon">◎</div>
          <p style="font-size:1rem; margin-bottom:.4rem">
            ${data.connected ? 'Camera found — no stream running' : 'No camera detected'}
          </p>
          <p style="font-size:.82rem; color:var(--text-muted); max-width:380px; line-height:1.5">
            ${isOnPi
              ? 'Run <code>./scripts/start-camera-stream.sh</code> on the Pi, or enter the stream URL in the <strong>Setup</strong> tab.'
              : 'You\'re on Windows/Mac. Enter your Pi\'s stream URL in the <strong>Setup</strong> tab to see the live feed here.'}
          </p>
          <button class="btn btn-primary" style="margin-top:1rem"
            onclick="app.camTab('setup', document.querySelectorAll('.cam-tab')[2])">
            Go to Setup →
          </button>
        </div>`;
    }

    // ── Detected devices list (setup tab) ─────────────────────────
    if (infoEl) {
      if (data.cameras?.length) {
        infoEl.innerHTML = data.cameras.map(c => `
          <div style="padding:.55rem 0; border-bottom:1px solid var(--border); font-size:.85rem; display:flex; justify-content:space-between; align-items:center; gap:.5rem">
            <div>
              <div style="font-weight:600; color:var(--text-primary)">${c.name}</div>
              <div class="mono" style="font-size:.75rem; color:var(--text-muted)">${c.device}</div>
            </div>
            ${c.isLogitech ? '<span style="color:var(--accent); font-size:.75rem; font-weight:600">Logitech ✓</span>' : ''}
          </div>`).join('');
      } else {
        infoEl.innerHTML = `<div style="font-size:.85rem; color:var(--text-muted); padding:.5rem 0">
          No cameras detected on this machine.<br>
          ${isOnPi ? 'Check: <code>ls /dev/video*</code>' : 'Camera will be detected when running on the Pi.'}
        </div>`;
      }
    }
  }

  function saveCamUrls() {
    const streamUrl = document.getElementById('cam-stream-url')?.value?.trim();
    const snapshotUrl = document.getElementById('cam-snapshot-url')?.value?.trim();
    if (!streamUrl) { toast('Enter a stream URL first', 'error'); return; }
    localStorage.setItem('cam_stream_url', streamUrl);
    if (snapshotUrl) localStorage.setItem('cam_snapshot_url', snapshotUrl);
    toast('Stream URL saved', 'success');
    // Switch to stream tab and reload
    camTab('stream', document.querySelectorAll('.cam-tab')[0]);
    loadCamera();
  }

  function takeSnapshot() {
    const snapshotUrl = localStorage.getItem('cam_snapshot_url') || localStorage.getItem('cam_stream_url');
    const viewer = document.getElementById('camera-snapshot-viewer');
    const timeEl = document.getElementById('snapshot-time');
    if (!snapshotUrl) {
      toast('Set a snapshot URL in the Setup tab first', 'error');
      return;
    }
    const ts = new Date().toLocaleTimeString();
    // Add cache-busting param so it fetches a fresh frame
    const url = snapshotUrl.includes('?') ? `${snapshotUrl}&_t=${Date.now()}` : `${snapshotUrl}?_t=${Date.now()}`;
    viewer.innerHTML = `<img src="${url}" alt="Snapshot" style="width:100%; max-width:900px; border-radius:8px; display:block; margin:0 auto"
      onerror="document.getElementById('camera-snapshot-viewer').innerHTML = app.cameraError('${snapshotUrl}')" />`;
    if (timeEl) timeEl.textContent = `Captured at ${ts}`;
    toast('Snapshot taken', 'success');
  }

  // Exported so inline onerror handlers can call it
  function cameraError(url) {
    return `<div class="camera-placeholder" style="padding:2.5rem">
      <div class="cam-icon" style="color:var(--red)">◎</div>
      <p style="color:var(--red)">Stream failed to load</p>
      <code style="font-size:.75rem; color:var(--text-muted); word-break:break-all">${url}</code>
      <p style="font-size:.78rem; color:var(--text-muted); margin-top:.5rem">Check the URL is reachable and the stream is running</p>
    </div>`;
  }

  // ─── COMMANDS ────────────────────────────────────────────────────
  async function loadCommands() {
    const listEl = document.getElementById('command-list');
    try {
      const commands = await api('/api/command/list');
      listEl.innerHTML = commands.map(cmd => `
        <div class="cmd-item" onclick="app.prefillCommand('${cmd.examples[0]}')">
          <div class="cmd-name">${cmd.name}</div>
          <div class="cmd-example">${cmd.examples[0]}</div>
        </div>`).join('');
    } catch {
      listEl.innerHTML = '<div class="empty-state">Could not load commands.</div>';
    }
  }

  function prefillCommand(text) {
    const input = document.getElementById('command-input');
    if (input) { input.value = text; input.focus(); }
  }

  async function sendCommand() {
    const input = document.getElementById('command-input');
    const resultEl = document.getElementById('command-result');
    const text = input?.value?.trim();
    if (!text) return;

    resultEl.className = 'command-result info';
    resultEl.textContent = 'Running…';

    try {
      const result = await post('/api/command', { text });

      resultEl.className = `command-result ${result.success ? 'success' : 'error'}`;
      resultEl.textContent = result.message || (result.success ? 'Done' : 'Command failed');

      if (result.success && result.ui_action === 'navigate' && result.target) {
        setTimeout(() => navigateTo(result.target.replace('/', '')), 600);
      }
    } catch (err) {
      resultEl.className = 'command-result error';
      resultEl.textContent = `Error: ${err.message}`;
    }
  }

  // ─── AUTOMATIONS ─────────────────────────────────────────────────
  async function loadAutomations() {
    const haList = document.getElementById('ha-automations-list');
    const localList = document.getElementById('local-automations-list');

    // HA automations
    try {
      const autos = await api('/api/ha/automations');
      if (!autos.length) {
        haList.innerHTML = '<div class="empty-state">No automations found in Home Assistant.</div>';
      } else {
        haList.innerHTML = autos.map(auto => `
          <div class="auto-row">
            <div class="auto-row-left">
              <div class="auto-name">${auto.name}</div>
              <div class="auto-meta">
                ${auto.last_triggered ? `Last triggered: ${new Date(auto.last_triggered).toLocaleString()}` : 'Never triggered'}
              </div>
            </div>
            <div class="auto-row-right">
              <span class="device-state ${auto.state === 'on' ? 'state-on' : 'state-off'}">${auto.state}</span>
              <button class="btn btn-ghost btn-sm" onclick="app.triggerHAAutomation('${auto.entity_id}')">▶ Run</button>
            </div>
          </div>`).join('');
      }
    } catch {
      haList.innerHTML = '<div class="empty-state">Could not load HA automations.</div>';
    }

    // Local automations
    try {
      const locals = await api('/api/automations');
      if (!locals.length) {
        localList.innerHTML = '<div class="empty-state">No local rules yet. Add one above.</div>';
      } else {
        localList.innerHTML = locals.map(rule => `
          <div class="auto-row">
            <div class="auto-row-left">
              <div class="auto-name">${rule.name}</div>
              <div class="auto-meta">Trigger: "${rule.trigger?.value || rule.trigger}" · ${rule.enabled ? 'Enabled' : 'Disabled'}</div>
            </div>
            <div class="auto-row-right">
              <span class="device-state ${rule.enabled ? 'state-on' : 'state-off'}">${rule.enabled ? 'on' : 'off'}</span>
              <button class="btn btn-ghost btn-sm" onclick="app.triggerLocalAutomation('${rule.id}')">▶ Run</button>
              <button class="btn btn-danger btn-sm" onclick="app.deleteAutomation('${rule.id}')">✕</button>
            </div>
          </div>`).join('');
      }
    } catch {
      localList.innerHTML = '<div class="empty-state">Could not load local automations.</div>';
    }
  }

  async function triggerHAAutomation(entity_id) {
    try {
      await post('/api/ha/service', { domain: 'automation', service: 'trigger', entity_id });
      toast('Automation triggered', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function triggerLocalAutomation(id) {
    try {
      await post(`/api/automations/${id}/trigger`, {});
      toast('Rule triggered', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteAutomation(id) {
    if (!confirm('Delete this automation rule?')) return;
    try {
      await api(`/api/automations/${id}`, { method: 'DELETE' });
      toast('Rule deleted', 'info');
      loadAutomations();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function showAddAutomation() {
    document.getElementById('add-automation-modal').style.display = 'flex';
  }

  async function saveAutomation() {
    const name = document.getElementById('auto-name').value.trim();
    const triggerVal = document.getElementById('auto-trigger').value.trim();
    const actionsRaw = document.getElementById('auto-actions').value.trim();

    if (!name || !triggerVal || !actionsRaw) {
      toast('All fields required', 'error');
      return;
    }

    let actions;
    try { actions = JSON.parse(actionsRaw); }
    catch { toast('Actions must be valid JSON', 'error'); return; }

    try {
      await post('/api/automations', {
        name,
        trigger: { type: 'command', value: triggerVal },
        actions,
      });
      hideModal('add-automation-modal');
      toast('Automation saved', 'success');
      loadAutomations();
      // Clear form
      ['auto-name', 'auto-trigger', 'auto-actions'].forEach(id => { document.getElementById(id).value = ''; });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function hideModal(id) {
    document.getElementById(id).style.display = 'none';
  }

  // ─── SETTINGS PAGE ───────────────────────────────────────────────
  async function loadSettingsPage() {
    try {
      const s = await api('/api/settings');
      const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
      set('set-ha-url', s.ha_url);
      set('set-camera-device', s.camera_device);
      set('set-camera-port', s.camera_stream_port);
      set('set-dashboard-name', s.dashboard_name);
      set('set-refresh', s.refresh_interval);

      const pi = await api('/api/settings/system');
      const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
      setText('pi-hostname', pi.hostname);
      setText('pi-model', pi.model);
      setText('pi-uptime', pi.uptime);
      setText('pi-temp', pi.temperature);
    } catch { /* ignore */ }
  }

  async function saveSettings() {
    const get = (id) => document.getElementById(id)?.value?.trim();
    const updated = {
      ha_url: get('set-ha-url'),
      camera_device: get('set-camera-device'),
      camera_stream_port: get('set-camera-port'),
      dashboard_name: get('set-dashboard-name'),
      refresh_interval: parseInt(get('set-refresh')) || 5000,
    };

    try {
      await patch('/api/settings', updated);
      toast('Settings saved', 'success');
      loadSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function testHA() {
    const resultEl = document.getElementById('ha-test-result');
    resultEl.textContent = 'Testing…';
    resultEl.style.color = 'var(--text-muted)';
    try {
      const data = await api('/api/ha/status');
      resultEl.textContent = data.connected ? `✓ Connected — ${data.message}` : `✗ ${data.error}`;
      resultEl.style.color = data.connected ? 'var(--green)' : 'var(--red)';
    } catch (err) {
      resultEl.textContent = `✗ ${err.message}`;
      resultEl.style.color = 'var(--red)';
    }
  }

  // ─── SYSTEM ──────────────────────────────────────────────────────
  async function restartCheck() {
    try {
      const data = await api('/api/health');
      toast(`Server up ${Math.round(data.uptime)}s`, 'info');
    } catch {
      toast('Server unreachable', 'error');
    }
  }

  async function refreshAll() {
    const page = location.hash.replace('#', '') || 'dashboard';
    navigateTo(page);
    toast('Refreshed', 'info');
  }

  // ─── TOAST ───────────────────────────────────────────────────────
  function toast(message, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────
  return {
    init,
    navigateTo,
    toggleEntity,
    quickAction,
    refreshAll,
    loadDevices,
    filterDevices,
    loadCamera,
    camTab,
    saveCamUrls,
    takeSnapshot,
    cameraError,
    loadCommands,
    sendCommand,
    prefillCommand,
    loadAutomations,
    triggerHAAutomation,
    triggerLocalAutomation,
    deleteAutomation,
    showAddAutomation,
    saveAutomation,
    hideModal,
    loadSettingsPage,
    saveSettings,
    testHA,
    restartCheck,
    toast,
  };
})();

document.addEventListener('DOMContentLoaded', () => app.init());
