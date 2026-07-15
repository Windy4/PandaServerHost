'use strict';

// Usage: node scripts/create-admin.js <username> <password> [email]
// Creates an admin account, or promotes an existing user to admin.

const bcrypt = require('bcryptjs');
const db = require('../src/db');

const [, , username, password, email] = process.argv;
if (!username || !password) {
  console.error('Usage: node scripts/create-admin.js <username> <password> [email]');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
  console.log(`Promoted existing user "${username}" to admin.`);
} else {
  const hash = bcrypt.hashSync(String(password), 12);
  db.prepare(
    'INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(username, email || null, hash, 'admin', Date.now());
  console.log(`Created admin user "${username}".`);
}
