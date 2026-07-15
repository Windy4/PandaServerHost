'use strict';

const path = require('path');

/**
 * Resolve a user-supplied relative path against a jailed root, guaranteeing the
 * result stays inside root. Blocks path traversal (../), absolute paths, and
 * NUL bytes. Returns the absolute resolved path, or throws.
 */
function resolveInside(root, relative) {
  const rootResolved = path.resolve(root);
  const rel = String(relative || '').replace(/\0/g, '');
  // Strip any leading slashes so it's always treated as relative.
  const cleaned = rel.replace(/^[/\\]+/, '');
  const target = path.resolve(rootResolved, cleaned);
  const withSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (target !== rootResolved && !target.startsWith(withSep)) {
    throw new Error('path escapes server directory');
  }
  return target;
}

module.exports = { resolveInside };
