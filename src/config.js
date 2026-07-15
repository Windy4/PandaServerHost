'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

function bool(v, def = false) {
  if (v === undefined) return def;
  return String(v).toLowerCase() === 'true';
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const ROOT = path.resolve(__dirname, '..');

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'change-me-to-a-long-random-string') {
  // Never run with a default secret. If missing, generate an ephemeral one so
  // the app still boots, but warn loudly — restarts will invalidate sessions.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[config] WARNING: JWT_SECRET is not set. Using a temporary random secret. ' +
      'Set JWT_SECRET in .env for stable sessions.'
  );
}

const config = {
  root: ROOT,
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',

  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  secureCookies: bool(process.env.SECURE_COOKIES, false),

  dataDir: path.join(ROOT, 'data'),
  serversDir: process.env.SERVERS_DIR
    ? path.resolve(process.env.SERVERS_DIR)
    : path.join(ROOT, 'servers'),

  mcImage: process.env.MC_IMAGE || 'itzg/minecraft-server:latest',
  portMin: int(process.env.MC_PORT_MIN, 25565),
  portMax: int(process.env.MC_PORT_MAX, 25600),

  limits: {
    maxRamMb: int(process.env.MAX_RAM_MB, 8192),
    maxCpuCores: int(process.env.MAX_CPU_CORES, 4),
    maxDiskMb: int(process.env.MAX_DISK_MB, 20480),
  },
};

module.exports = config;
