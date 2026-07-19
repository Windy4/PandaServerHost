'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { allocatePort } = require('../services/ports');
const dockerSvc = require('../services/docker');

const router = express.Router();

const listRequests = db.prepare(`
  SELECT r.*, u.username AS owner_username
  FROM requests r JOIN users u ON u.id = r.user_id
  ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
`);
const getRequest = db.prepare('SELECT * FROM requests WHERE id = ?');
const setRequestDecision = db.prepare(
  "UPDATE requests SET status = ?, admin_note = ?, decided_at = ? WHERE id = ?"
);
const insertServer = db.prepare(`
  INSERT INTO servers (request_id, owner_id, name, server_type, mc_version, ram_mb, cpu_cores, disk_mb, host_port, status, created_at)
  VALUES (@request_id, @owner_id, @name, @server_type, @mc_version, @ram_mb, @cpu_cores, @disk_mb, @host_port, 'created', @created_at)
`);
const setServerContainer = db.prepare('UPDATE servers SET container_id = ?, status = ? WHERE id = ?');
const getServerRow = db.prepare('SELECT * FROM servers WHERE id = ?');
const updateServerResources = db.prepare(
  'UPDATE servers SET ram_mb = ?, cpu_cores = ?, disk_mb = ? WHERE id = ?'
);
const listServers = db.prepare(`
  SELECT s.*, u.username AS owner_username
  FROM servers s JOIN users u ON u.id = s.owner_id
  ORDER BY s.created_at DESC
`);
const listUsers = db.prepare('SELECT id, username, email, role, created_at FROM users ORDER BY created_at');

router.use(requireAdmin);

router.get('/requests', (req, res) => res.json({ requests: listRequests.all() }));
router.get('/servers', (req, res) => res.json({ servers: listServers.all() }));
router.get('/users', (req, res) => res.json({ users: listUsers.all() }));

router.post('/requests/:id/reject', (req, res) => {
  const reqRow = getRequest.get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'request not found' });
  if (reqRow.status !== 'pending') return res.status(409).json({ error: 'already decided' });
  setRequestDecision.run('rejected', String(req.body.note || '').slice(0, 500) || null, Date.now(), reqRow.id);
  res.json({ ok: true });
});

// Approve a request: allocate a port, create the server row, deploy the container.
router.post('/requests/:id/approve', async (req, res) => {
  const reqRow = getRequest.get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'request not found' });
  if (reqRow.status !== 'pending') return res.status(409).json({ error: 'already decided' });

  let port;
  try {
    port = allocatePort();
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }

  const decide = db.transaction(() => {
    setRequestDecision.run('approved', String(req.body.note || '').slice(0, 500) || null, Date.now(), reqRow.id);
    const info = insertServer.run({
      request_id: reqRow.id,
      owner_id: reqRow.user_id,
      name: reqRow.name,
      server_type: reqRow.server_type,
      mc_version: reqRow.mc_version,
      ram_mb: reqRow.ram_mb,
      cpu_cores: reqRow.cpu_cores,
      disk_mb: reqRow.disk_mb,
      host_port: port,
      created_at: Date.now(),
    });
    return info.lastInsertRowid;
  });

  const serverId = decide();
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);

  // Deploy asynchronously-ish, but await so the admin sees the result.
  try {
    const containerId = await dockerSvc.deployServer(server);
    setServerContainer.run(containerId, 'running', serverId);
    res.json({ ok: true, server_id: serverId, host_port: port, status: 'running' });
  } catch (e) {
    setServerContainer.run(null, 'error', serverId);
    res.status(500).json({
      ok: false,
      server_id: serverId,
      host_port: port,
      error: 'server row created but container deploy failed: ' + e.message,
    });
  }
});

// Change a server's resource limits (RAM / CPU / disk) and redeploy it so the
// new limits and JVM heap take effect. Recreating the container is required
// because the JVM heap (-Xmx) is fixed at start; the world/files on the mounted
// volume are preserved. Same host port is kept.
router.post('/servers/:id/resources', async (req, res) => {
  const server = getServerRow.get(req.params.id);
  if (!server) return res.status(404).json({ error: 'server not found' });

  const b = req.body || {};
  const ram = parseInt(b.ram_mb, 10);
  const cpu = parseFloat(b.cpu_cores);
  const disk = parseInt(b.disk_mb, 10);
  const L = config.limits;

  if (!Number.isFinite(ram) || ram < 512 || ram > L.maxRamMb) {
    return res.status(400).json({ error: `ram_mb must be 512-${L.maxRamMb}` });
  }
  if (!Number.isFinite(cpu) || cpu < 0.5 || cpu > L.maxCpuCores) {
    return res.status(400).json({ error: `cpu_cores must be 0.5-${L.maxCpuCores}` });
  }
  if (!Number.isFinite(disk) || disk < 512 || disk > L.maxDiskMb) {
    return res.status(400).json({ error: `disk_mb must be 512-${L.maxDiskMb}` });
  }

  updateServerResources.run(ram, cpu, disk, server.id);
  const updated = getServerRow.get(server.id);

  try {
    const containerId = await dockerSvc.deployServer(updated);
    setServerContainer.run(containerId, 'running', server.id);
    res.json({ ok: true, server_id: server.id, ram_mb: ram, cpu_cores: cpu, disk_mb: disk, status: 'running' });
  } catch (e) {
    setServerContainer.run(null, 'error', server.id);
    res.status(500).json({ error: 'limits saved but redeploy failed: ' + e.message });
  }
});

module.exports = router;
