/**
 * Home Assistant API Integration
 * Wraps the HA REST API with error handling and caching
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

function getHAClient() {
  const baseURL = process.env.HA_URL;
  const token = process.env.HA_TOKEN;

  if (!baseURL || !token) {
    throw new Error('HA_URL and HA_TOKEN must be set in .env');
  }

  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 8000,
  });
}

// Exported for WebSocket polling
async function fetchStates() {
  const client = getHAClient();
  const res = await client.get('/api/states');
  return res.data;
}

module.exports.fetchStates = fetchStates;

// GET /api/ha/status — Check HA connection
router.get('/status', async (req, res) => {
  try {
    const client = getHAClient();
    const response = await client.get('/api/');
    res.json({ connected: true, message: response.data.message, version: response.data.version });
  } catch (err) {
    res.status(503).json({ connected: false, error: err.message });
  }
});

// GET /api/ha/states — All entity states
router.get('/states', async (req, res) => {
  try {
    const states = await fetchStates();
    res.json(states);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ha/states/:entity_id — Single entity state
router.get('/states/:entity_id', async (req, res) => {
  try {
    const client = getHAClient();
    const response = await client.get(`/api/states/${req.params.entity_id}`);
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// POST /api/ha/service — Call a HA service
// Body: { domain, service, entity_id, ...extra_data }
router.post('/service', async (req, res) => {
  try {
    const { domain, service, entity_id, ...extra_data } = req.body;
    if (!domain || !service) {
      return res.status(400).json({ error: 'domain and service are required' });
    }

    const client = getHAClient();
    const payload = entity_id ? { entity_id, ...extra_data } : extra_data;
    const response = await client.post(`/api/services/${domain}/${service}`, payload);
    res.json({ success: true, result: response.data });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/ha/entities — Filtered entity list by domain
// Query: ?domain=light,switch,media_player
router.get('/entities', async (req, res) => {
  try {
    const states = await fetchStates();
    const domains = req.query.domain ? req.query.domain.split(',') : null;

    const filtered = states
      .filter(s => !domains || domains.some(d => s.entity_id.startsWith(d + '.')))
      .map(s => ({
        entity_id: s.entity_id,
        state: s.state,
        friendly_name: s.attributes?.friendly_name || s.entity_id,
        domain: s.entity_id.split('.')[0],
        attributes: s.attributes,
        last_changed: s.last_changed,
      }));

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ha/automations — List HA automations
router.get('/automations', async (req, res) => {
  try {
    const states = await fetchStates();
    const automations = states
      .filter(s => s.entity_id.startsWith('automation.'))
      .map(s => ({
        entity_id: s.entity_id,
        name: s.attributes?.friendly_name || s.entity_id,
        state: s.state,
        last_triggered: s.attributes?.last_triggered,
      }));
    res.json(automations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ha/toggle/:entity_id — Toggle entity state
router.post('/toggle/:entity_id', async (req, res) => {
  try {
    const { entity_id } = req.params;
    const domain = entity_id.split('.')[0];
    const client = getHAClient();
    const response = await client.post(`/api/services/${domain}/toggle`, { entity_id });
    res.json({ success: true, result: response.data });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchStates = fetchStates;
