'use strict';

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const dockerSvc = require('./services/docker');

const getUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?');
const getServer = db.prepare('SELECT * FROM servers WHERE id = ?');

// Matches /ws/servers/<id>/logs
const LOGS_RE = /^\/ws\/servers\/(\d+)\/logs\/?$/;

function parseCookie(header, name) {
  if (!header) return null;
  const part = header
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + '='));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

/**
 * Authenticate an upgrade request the same way HTTP routes do: verify the JWT
 * from the auth cookie, then confirm the user owns the server (or is admin).
 * Returns { user, server } or null.
 */
function authorize(req) {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(LOGS_RE);
  if (!m) return null;

  const token = parseCookie(req.headers.cookie, 'token');
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (_e) {
    return null;
  }
  const user = getUser.get(payload.sub);
  if (!user) return null;

  const server = getServer.get(Number(m[1]));
  if (!server) return null;
  if (user.role !== 'admin' && server.owner_id !== user.id) return null;

  return { user, server };
}

function attach(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    // Only handle our log path; ignore other upgrades.
    if (!LOGS_RE.test(new URL(req.url, 'http://localhost').pathname)) {
      socket.destroy();
      return;
    }
    const ctx = authorize(req);
    if (!ctx) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, ctx);
    });
  });

  wss.on('connection', async (ws, _req, ctx) => {
    let stop = null;
    const safeSend = (t) => {
      if (ws.readyState === ws.OPEN) ws.send(t);
    };
    try {
      stop = await dockerSvc.streamLogs(ctx.server, {
        tail: 300,
        onData: (text) => safeSend(text),
        onEnd: () => {
          safeSend('\n[stream ended — the server may have stopped or is restarting]\n');
        },
      });
    } catch (e) {
      safeSend('[could not attach to server logs: ' + e.message + ']');
    }

    ws.on('close', () => {
      if (stop) stop();
    });
    ws.on('error', () => {
      if (stop) stop();
    });
  });

  return wss;
}

module.exports = { attach };
