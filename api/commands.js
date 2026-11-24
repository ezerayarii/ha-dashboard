/**
 * Command Parser
 * Converts plain-text commands into Home Assistant service calls
 * Designed to be easily extended with AI/NLP in the future
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

// ─── Command Rules ────────────────────────────────────────────────────────────
// Each rule: { pattern (regex), action (fn returning HA call descriptor) }
const COMMAND_RULES = [
  // LIGHTS
  {
    name: 'Turn on all lights',
    patterns: [/turn on (all )?lights?/i, /lights? on/i, /brighten (the )?room/i],
    action: () => ({ domain: 'light', service: 'turn_on', entity_id: 'all', message: 'Turning on all lights' }),
  },
  {
    name: 'Turn off all lights',
    patterns: [/turn off (all )?lights?/i, /lights? off/i, /darken (the )?room/i],
    action: () => ({ domain: 'light', service: 'turn_off', entity_id: 'all', message: 'Turning off all lights' }),
  },
  {
    name: 'Dim lights',
    patterns: [/dim (the )?lights?/i, /low(er)? (the )?lights?/i],
    action: () => ({ domain: 'light', service: 'turn_on', entity_id: 'all', service_data: { brightness_pct: 20 }, message: 'Dimming lights to 20%' }),
  },

  // TV / MEDIA
  {
    name: 'Turn on TV',
    patterns: [/turn on (the )?tv/i, /tv on/i, /start (the )?tv/i],
    action: () => ({ domain: 'media_player', service: 'turn_on', entity_id: 'all', message: 'Turning on TV' }),
  },
  {
    name: 'Turn off TV',
    patterns: [/turn off (the )?tv/i, /tv off/i, /stop (the )?tv/i],
    action: () => ({ domain: 'media_player', service: 'turn_off', entity_id: 'all', message: 'Turning off TV' }),
  },

  // SCENES / MODES
  {
    name: 'Night mode',
    patterns: [/night mode/i, /bedtime/i, /good ?night/i, /sleep mode/i],
    action: () => ({ domain: 'scene', service: 'turn_on', entity_id: 'scene.night_mode', message: 'Activating night mode', multi: [
      { domain: 'light', service: 'turn_off', entity_id: 'all' },
      { domain: 'media_player', service: 'turn_off', entity_id: 'all' },
    ]}),
  },
  {
    name: 'Movie mode',
    patterns: [/movie mode/i, /cinema mode/i, /watch (a )?movie/i, /film mode/i],
    action: () => ({ domain: 'scene', service: 'turn_on', entity_id: 'scene.movie_mode', message: 'Movie mode! Lights dim, TV on.', multi: [
      { domain: 'light', service: 'turn_on', entity_id: 'all', service_data: { brightness_pct: 10 } },
      { domain: 'media_player', service: 'turn_on', entity_id: 'all' },
    ]}),
  },
  {
    name: 'Morning mode',
    patterns: [/morning mode/i, /good morning/i, /wake up/i],
    action: () => ({ message: 'Good morning! Lights on.', multi: [
      { domain: 'light', service: 'turn_on', entity_id: 'all', service_data: { brightness_pct: 80, color_temp: 4000 } },
    ]}),
  },

  // CAMERA
  {
    name: 'Show camera',
    patterns: [/show camera/i, /open camera/i, /camera (view|feed|stream)/i],
    action: () => ({ ui_action: 'navigate', target: '/camera', message: 'Opening camera view' }),
  },

  // SYSTEM
  {
    name: 'Status check',
    patterns: [/status/i, /how is everything/i, /system check/i],
    action: () => ({ ui_action: 'status', message: 'Checking system status...' }),
  },
];

async function callHAService(desc) {
  const baseURL = process.env.HA_URL;
  const token = process.env.HA_TOKEN;
  if (!baseURL || !token) throw new Error('HA not configured');

  const client = axios.create({
    baseURL,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 5000,
  });

  if (desc.multi) {
    // Execute multiple service calls
    const results = [];
    for (const call of desc.multi) {
      const payload = call.entity_id ? { entity_id: call.entity_id, ...(call.service_data || {}) } : (call.service_data || {});
      try {
        await client.post(`/api/services/${call.domain}/${call.service}`, payload);
        results.push({ success: true, call });
      } catch (err) {
        results.push({ success: false, call, error: err.message });
      }
    }
    return results;
  }

  if (desc.domain && desc.service) {
    const payload = desc.entity_id ? { entity_id: desc.entity_id, ...(desc.service_data || {}) } : (desc.service_data || {});
    const response = await client.post(`/api/services/${desc.domain}/${desc.service}`, payload);
    return response.data;
  }

  return null;
}

// POST /api/command
router.post('/', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  const input = text.trim();

  // Find matching rule
  let matched = null;
  for (const rule of COMMAND_RULES) {
    if (rule.patterns.some(p => p.test(input))) {
      matched = rule;
      break;
    }
  }

  if (!matched) {
    return res.json({
      success: false,
      command: input,
      message: `Command not recognized: "${input}". Try: "turn on lights", "movie mode", "night mode", "turn off TV"`,
      suggestions: COMMAND_RULES.map(r => r.name),
    });
  }

  const action = matched.action();

  // UI-only actions (navigation, status)
  if (action.ui_action) {
    return res.json({ success: true, command: input, message: action.message, ui_action: action.ui_action, target: action.target });
  }

  // Execute HA service
  try {
    const result = await callHAService(action);
    res.json({ success: true, command: input, message: action.message, rule: matched.name, result });
  } catch (err) {
    res.status(500).json({ success: false, command: input, message: action.message, error: err.message });
  }
});

// GET /api/command/list — Available commands
router.get('/list', (req, res) => {
  res.json(COMMAND_RULES.map(r => ({
    name: r.name,
    examples: r.patterns.map(p => p.source.replace(/[\\^$*+?.()|[\]{}]/g, '').replace(/\//g, '')),
  })));
});

module.exports = router;
