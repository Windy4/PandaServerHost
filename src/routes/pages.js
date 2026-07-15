'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const getServer = db.prepare('SELECT * FROM servers WHERE id = ?');

router.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { mode: 'login' });
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { mode: 'register' });
});

router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { user: req.user });
});

router.get('/admin', requireAdmin, (req, res) => {
  res.render('admin', { user: req.user });
});

// Per-server dashboard. The URL requires a valid login token AND ownership;
// loadServer-style checks are enforced by the /api/servers/:id endpoints the
// page calls, and here we gate the HTML too.
router.get('/servers/:id', requireAuth, (req, res) => {
  const server = getServer.get(req.params.id);
  if (!server) return res.status(404).render('error', { message: 'Server not found' });
  if (req.user.role !== 'admin' && server.owner_id !== req.user.id) {
    return res.status(403).render('error', { message: 'You do not have access to this server.' });
  }
  res.render('server', { user: req.user, server });
});

module.exports = router;
