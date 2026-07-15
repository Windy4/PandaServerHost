'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'panda.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  server_type  TEXT NOT NULL,     -- PAPER | FABRIC | VANILLA | FORGE
  mc_version   TEXT NOT NULL,     -- e.g. 1.21.1 or LATEST
  ram_mb       INTEGER NOT NULL,
  cpu_cores    REAL NOT NULL,
  disk_mb      INTEGER NOT NULL,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  admin_note   TEXT,
  created_at   INTEGER NOT NULL,
  decided_at   INTEGER
);

CREATE TABLE IF NOT EXISTS servers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  server_type   TEXT NOT NULL,
  mc_version    TEXT NOT NULL,
  ram_mb        INTEGER NOT NULL,
  cpu_cores     REAL NOT NULL,
  disk_mb       INTEGER NOT NULL,
  host_port     INTEGER NOT NULL UNIQUE,
  container_id  TEXT,
  status        TEXT NOT NULL DEFAULT 'created', -- created | running | stopped | error
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id);
`);

module.exports = db;
