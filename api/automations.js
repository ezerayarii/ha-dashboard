/**
 * Local Automations
 * Stores simple automation rules in a JSON file
 * These complement (not replace) HA's built-in automations
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DATA_FILE = path.join(__dirname, '../config/automations.json');

function loadAutomations() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveAutomations(automations) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(automations, null, 2));
}

// GET /api/automations
router.get('/', (req, res) => {
  res.json(loadAutomations());
});

// POST /api/automations — Create a new automation rule
router.post('/', (req, res) => {
  const { name, trigger, actions, enabled = true } = req.body;
  if (!name || !trigger || !actions) {
    return res.status(400).json({ error: 'name, trigger, and actions are required' });
  }

  const automations = loadAutomations();
  const newRule = {
    id: `auto_${Date.now()}`,
    name,
    trigger,   // e.g. { type: 'command', value: 'movie mode' }
    actions,   // e.g. [{ domain: 'light', service: 'turn_off', entity_id: 'all' }]
    enabled,
    created: new Date().toISOString(),
    last_triggered: null,
  };

  automations.push(newRule);
  saveAutomations(automations);
  res.status(201).json(newRule);
});

// PATCH /api/automations/:id — Update (enable/disable/rename)
router.patch('/:id', (req, res) => {
  const automations = loadAutomations();
  const idx = automations.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  automations[idx] = { ...automations[idx], ...req.body, id: automations[idx].id };
  saveAutomations(automations);
  res.json(automations[idx]);
});

// DELETE /api/automations/:id
router.delete('/:id', (req, res) => {
  const automations = loadAutomations();
  const filtered = automations.filter(a => a.id !== req.params.id);
  if (filtered.length === automations.length) return res.status(404).json({ error: 'Not found' });
  saveAutomations(filtered);
  res.json({ success: true });
});

// POST /api/automations/:id/trigger — Manually trigger an automation
router.post('/:id/trigger', async (req, res) => {
  const automations = loadAutomations();
  const rule = automations.find(a => a.id === req.params.id);
  if (!rule) return res.status(404).json({ error: 'Not found' });

  // Update last triggered
  rule.last_triggered = new Date().toISOString();
  saveAutomations(automations);

  res.json({ success: true, triggered: rule.name, actions: rule.actions });
});

module.exports = router;
