'use strict';

// Minimal shared helpers used across pages. Auth relies on the httpOnly cookie,
// so fetch just needs credentials:'same-origin'.
async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (_e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function showMsg(text, ok) {
  const el = document.getElementById('msg');
  if (!el) return;
  el.innerHTML = '<div class="notice ' + (ok ? 'ok' : 'err') + '">' + esc(text) + '</div>';
  if (ok) setTimeout(() => { el.innerHTML = ''; }, 4000);
}

function fmtBytes(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb + ' MB';
}

function wireLogout() {
  const link = document.getElementById('logoutLink');
  if (!link) return;
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/auth/logout'); } catch (_e) {}
    window.location.href = '/login';
  });
}
document.addEventListener('DOMContentLoaded', wireLogout);
