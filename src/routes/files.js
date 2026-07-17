'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const dockerSvc = require('../services/docker');
const { resolveInside } = require('../services/safepath');

// mergeParams so :id from the parent (servers) router is available here.
const router = express.Router({ mergeParams: true });

// Text file types we allow editing in-browser (configs, properties, etc.).
const EDITABLE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024; // 200 MB (mods/plugins can be large)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
});

function rootFor(req) {
  return dockerSvc.serverDataDir(req.server.id);
}

// Internal/credential files the panel manages that a server owner must never
// see or touch. `.rcon-cli.env` / `.rcon-cli.yaml` contain the RCON password.
// Matched case-insensitively on the file's basename only (legit config files
// like paper-global.yml / bukkit.yml are NOT hidden).
const HIDDEN_NAMES = new Set(['.rcon-cli.env', '.rcon-cli.yaml', '.rcon-cli.yml']);
function isHidden(name) {
  const n = String(name).toLowerCase();
  if (HIDDEN_NAMES.has(n)) return true;
  if (n.startsWith('.rcon-cli')) return true; // any rcon-cli.* variant
  return false;
}

// Throw if the target path (by basename) is a hidden/internal file. Used by
// every read/write/delete/download op so hidden files can't be reached even by
// requesting their exact path.
function guardHidden(absPath) {
  if (isHidden(path.basename(absPath))) {
    const err = new Error('file not found');
    err.hidden = true;
    throw err;
  }
}

// List a directory.
router.get('/list', async (req, res) => {
  try {
    const root = rootFor(req);
    fs.mkdirSync(root, { recursive: true });
    const dir = resolveInside(root, req.query.path || '');
    const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter(
      (e) => !isHidden(e.name)
    );
    const items = await Promise.all(
      entries.map(async (e) => {
        const full = path.join(dir, e.name);
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch (_e) {
          /* symlink dangling etc. */
        }
        return { name: e.name, dir: e.isDirectory(), size };
      })
    );
    items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    res.json({ path: path.relative(root, dir), items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Read a text file for editing.
router.get('/read', async (req, res) => {
  try {
    const root = rootFor(req);
    const file = resolveInside(root, req.query.path || '');
    guardHidden(file);
    const st = await fsp.stat(file);
    if (st.isDirectory()) return res.status(400).json({ error: 'that is a directory' });
    if (st.size > EDITABLE_MAX_BYTES) {
      return res.status(413).json({ error: 'file too large to edit in the browser' });
    }
    const content = await fsp.readFile(file, 'utf8');
    res.json({ content });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Save a text file.
router.post('/save', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const root = rootFor(req);
    const file = resolveInside(root, req.body.path || '');
    guardHidden(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, String(req.body.content ?? ''), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Download any file (mods, worlds, backups).
router.get('/download', async (req, res) => {
  try {
    const root = rootFor(req);
    const file = resolveInside(root, req.query.path || '');
    guardHidden(file);
    const st = await fsp.stat(file);
    if (st.isDirectory()) return res.status(400).json({ error: 'cannot download a directory' });
    res.download(file, path.basename(file));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Upload one or more files into a directory (add mods / plugins).
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const root = rootFor(req);
    const dir = resolveInside(root, req.body.path || '');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of req.files || []) {
      // Never trust the client filename for traversal.
      const safeName = path.basename(f.originalname);
      const dest = resolveInside(dir, safeName);
      guardHidden(dest); // don't let uploads clobber managed credential files
      await fsp.writeFile(dest, f.buffer);
    }
    res.json({ ok: true, count: (req.files || []).length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create a folder.
router.post('/mkdir', express.json(), async (req, res) => {
  try {
    const root = rootFor(req);
    const dir = resolveInside(root, req.body.path || '');
    await fsp.mkdir(dir, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete a file or folder.
router.post('/delete', express.json(), async (req, res) => {
  try {
    const root = rootFor(req);
    const target = resolveInside(root, req.body.path || '');
    guardHidden(target);
    if (target === path.resolve(root)) {
      return res.status(400).json({ error: 'cannot delete the server root' });
    }
    await fsp.rm(target, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
