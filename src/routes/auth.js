'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken, setAuthCookie } = require('../middleware/auth');

const router = express.Router();

// Throttle auth endpoints to blunt brute-force / credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' },
});

const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
);
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

router.post('/register', authLimiter, (req, res) => {
  const { username, email, password } = req.body || {};
  if (!USERNAME_RE.test(username || '')) {
    return res.status(400).json({ error: 'username must be 3-32 chars: letters, numbers, underscore' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (findByUsername.get(username)) {
    return res.status(409).json({ error: 'username already taken' });
  }
  // First account created becomes the admin (that's you).
  const role = countUsers.get().n === 0 ? 'admin' : 'user';
  const hash = bcrypt.hashSync(String(password), 12);
  const info = insertUser.run(username, email || null, hash, role, Date.now());
  const user = { id: info.lastInsertRowid, username, role };
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ ok: true, user: { username, role }, token });
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = findByUsername.get(username || '');
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'invalid username or password' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({
    ok: true,
    user: { username: user.username, role: user.role },
    token,
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ ok: true });
});

module.exports = router;
