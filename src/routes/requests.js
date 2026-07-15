'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_TYPES = ['PAPER', 'FABRIC', 'VANILLA', 'FORGE'];
const VERSION_RE = /^(LATEST|SNAPSHOT|[0-9]+(\.[0-9]+){1,2})$/;

const insertRequest = db.prepare(`
  INSERT INTO requests (user_id, name, server_type, mc_version, ram_mb, cpu_cores, disk_mb, note, status, created_at)
  VALUES (@user_id, @name, @server_type, @mc_version, @ram_mb, @cpu_cores, @disk_mb, @note, 'pending', @created_at)
`);
const listByUser = db.prepare('SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC');

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ requests: listByUser.all(req.user.id) });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const serverType = String(b.server_type || '').toUpperCase();
  const mcVersion = String(b.mc_version || 'LATEST').trim();
  const ram = parseInt(b.ram_mb, 10);
  const cpu = parseFloat(b.cpu_cores);
  const disk = parseInt(b.disk_mb, 10);

  if (!/^[\w .-]{2,40}$/.test(name)) {
    return res.status(400).json({ error: 'name must be 2-40 chars (letters, numbers, space, . _ -)' });
  }
  if (!VALID_TYPES.includes(serverType)) {
    return res.status(400).json({ error: `server_type must be one of ${VALID_TYPES.join(', ')}` });
  }
  if (!VERSION_RE.test(mcVersion)) {
    return res.status(400).json({ error: 'mc_version must be like 1.21.1, LATEST, or SNAPSHOT' });
  }
  if (!Number.isFinite(ram) || ram < 512 || ram > config.limits.maxRamMb) {
    return res.status(400).json({ error: `ram_mb must be 512-${config.limits.maxRamMb}` });
  }
  if (!Number.isFinite(cpu) || cpu < 0.5 || cpu > config.limits.maxCpuCores) {
    return res.status(400).json({ error: `cpu_cores must be 0.5-${config.limits.maxCpuCores}` });
  }
  if (!Number.isFinite(disk) || disk < 512 || disk > config.limits.maxDiskMb) {
    return res.status(400).json({ error: `disk_mb must be 512-${config.limits.maxDiskMb}` });
  }

  const info = insertRequest.run({
    user_id: req.user.id,
    name,
    server_type: serverType,
    mc_version: mcVersion,
    ram_mb: ram,
    cpu_cores: cpu,
    disk_mb: disk,
    note: String(b.note || '').slice(0, 500) || null,
    created_at: Date.now(),
  });
  res.json({ ok: true, id: info.lastInsertRowid });
});

module.exports = router;
