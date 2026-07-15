'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const dockerSvc = require('../services/docker');
const filesRouter = require('./files');

const router = express.Router();

const getServer = db.prepare('SELECT * FROM servers WHERE id = ?');
const listByOwner = db.prepare('SELECT * FROM servers WHERE owner_id = ? ORDER BY created_at DESC');
const setStatus = db.prepare('UPDATE servers SET status = ? WHERE id = ?');
const delServer = db.prepare('DELETE FROM servers WHERE id = ?');

router.use(requireAuth);

// List servers the current user is allowed to see.
router.get('/', (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all()
    : listByOwner.all(req.user.id);
  res.json({ servers: rows });
});

/**
 * Ownership gate for a single server. Only the owner (whose login token maps to
 * owner_id) or an admin may reach a given server's dashboard/controls.
 */
function loadServer(req, res, next) {
  const server = getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: 'server not found' });
  if (req.user.role !== 'admin' && server.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'you do not have access to this server' });
  }
  req.server = server;
  next();
}

router.get('/:id', loadServer, async (req, res) => {
  const live = await dockerSvc.statusOf(req.server).catch(() => 'unknown');
  res.json({ server: req.server, live_status: live });
});

router.post('/:id/start', loadServer, async (req, res) => {
  try {
    await dockerSvc.startServer(req.server);
    setStatus.run('running', req.server.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/stop', loadServer, async (req, res) => {
  try {
    await dockerSvc.stopServer(req.server);
    setStatus.run('stopped', req.server.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/restart', loadServer, async (req, res) => {
  try {
    await dockerSvc.restartServer(req.server);
    setStatus.run('running', req.server.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/logs', loadServer, async (req, res) => {
  try {
    const tail = Math.min(1000, parseInt(req.query.tail, 10) || 200);
    const text = await dockerSvc.tailLogs(req.server, tail);
    res.json({ logs: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/stats', loadServer, async (req, res) => {
  try {
    const stats = await dockerSvc.liveStats(req.server);
    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin-only: tear a server down entirely (container + row). Files remain on disk.
router.delete('/:id', loadServer, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'only an admin can delete a server' });
  }
  await dockerSvc.removeServer(req.server).catch(() => {});
  delServer.run(req.server.id);
  res.json({ ok: true });
});

// Mount the sandboxed file browser under each server, behind the same gate.
router.use('/:id/files', loadServer, filesRouter);

module.exports = router;
