'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const getUser = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?');

/**
 * Reads a login token from the httpOnly cookie or the Authorization header
 * (Bearer). Verifies it and attaches req.user. Does NOT reject on its own.
 */
function loadUser(req, _res, next) {
  let token = req.cookies && req.cookies.token;
  const header = req.headers.authorization;
  if (!token && header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  }
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = getUser.get(payload.sub);
      if (user) req.user = user;
    } catch (_e) {
      /* invalid/expired token — treated as anonymous */
    }
  }
  next();
}

/** Requires any authenticated user. Redirects browsers, 401s API calls. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.accepts('html')) return res.redirect('/login');
  return res.status(401).json({ error: 'authentication required' });
}

/** Requires an admin (that's you). */
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'authentication required' });
  }
  return res.status(403).json({ error: 'admin access required' });
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

module.exports = { loadUser, requireAuth, requireAdmin, signToken, setAuthCookie };
