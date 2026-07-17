'use strict';

const SID = document.querySelector('[data-server-id]').dataset.serverId;
const base = '/api/servers/' + SID;
let cwd = '';

// ---- Controls ----------------------------------------------------------
async function control(action) {
  try { await api('POST', base + '/' + action); showMsg('Server ' + action + ' requested.', true); refreshStatus(); }
  catch (e) { showMsg(e.message, false); }
}

async function refreshStatus() {
  try {
    const { live_status } = await api('GET', base);
    const badge = document.getElementById('statusBadge');
    badge.textContent = live_status;
    badge.className = 'badge ' + (live_status === 'running' ? 'running' : live_status === 'stopped' ? 'stopped' : 'error');
  } catch (_e) {}
}

async function refreshStats() {
  try {
    const { stats } = await api('GET', base + '/stats');
    document.getElementById('statCpu').textContent = stats.cpuPercent + ' %';
    document.getElementById('statMem').textContent = stats.memUsageMb + ' / ' + stats.memLimitMb + ' MB';
  } catch (_e) {
    document.getElementById('statCpu').textContent = '–';
    document.getElementById('statMem').textContent = '–';
  }
}

async function refreshLogs() {
  const el = document.getElementById('logs');
  try {
    const { logs } = await api('GET', base + '/logs?tail=300');
    el.textContent = logs || '(no output yet)';
    el.scrollTop = el.scrollHeight;
  } catch (e) { el.textContent = e.message; }
}

// ---- File browser ------------------------------------------------------
async function loadDir(p) {
  cwd = p || '';
  document.getElementById('curPath').textContent = cwd;
  const tbody = document.getElementById('fileTable');
  try {
    const data = await api('GET', base + '/files/list?path=' + encodeURIComponent(cwd));
    cwd = data.path;
    document.getElementById('curPath').textContent = cwd;
    if (!data.items.length) { tbody.innerHTML = '<tr><td class="muted">Empty folder</td></tr>'; return; }
    tbody.innerHTML = data.items.map((it) => {
      const full = (cwd ? cwd + '/' : '') + it.name;
      const icon = it.dir ? '📁' : '📄';
      const size = it.dir ? '' : fmtBytes(Math.max(1, Math.round(it.size / 1024 / 1024)) === 0 ? 0 : Math.round(it.size / 1024 / 1024)) ;
      const nameCell = '<span class="fname" data-path="' + esc(full) + '" data-dir="' + it.dir + '">' + icon + ' ' + esc(it.name) + '</span>';
      const actions =
        (it.dir ? '' : '<button data-edit="' + esc(full) + '">Edit</button> ' +
                       '<a class="btn" href="' + base + '/files/download?path=' + encodeURIComponent(full) + '">Download</a> ') +
        '<button class="danger" data-rm="' + esc(full) + '">Delete</button>';
      return '<tr><td>' + nameCell + '</td><td class="muted">' + (it.dir ? 'folder' : it.size + ' B') + '</td><td>' + actions + '</td></tr>';
    }).join('');
  } catch (e) { tbody.innerHTML = '<tr><td class="muted">' + esc(e.message) + '</td></tr>'; }
}

async function openEditor(p) {
  try {
    const { content } = await api('GET', base + '/files/read?path=' + encodeURIComponent(p));
    document.getElementById('editorCard').classList.remove('hidden');
    document.getElementById('editorName').textContent = p;
    document.getElementById('editor').value = content;
    document.getElementById('btnSaveFile').dataset.path = p;
    document.getElementById('editorCard').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { showMsg(e.message, false); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnStart').addEventListener('click', () => control('start'));
  document.getElementById('btnStop').addEventListener('click', () => control('stop'));
  document.getElementById('btnRestart').addEventListener('click', () => control('restart'));
  document.getElementById('btnRedeploy').addEventListener('click', async () => {
    if (!confirm('Recreate this server\'s container? Same port and files are kept.')) return;
    showMsg('Redeploying… this can take a moment.', true);
    try { await api('POST', base + '/redeploy'); showMsg('Redeployed.', true); refreshStatus(); refreshLogs(); }
    catch (e) { showMsg(e.message, false); }
  });
  document.getElementById('btnRefreshLogs').addEventListener('click', refreshLogs);

  document.getElementById('btnUp').addEventListener('click', () => {
    if (!cwd) return;
    const parts = cwd.split('/'); parts.pop();
    loadDir(parts.join('/'));
  });

  document.getElementById('btnMkdir').addEventListener('click', async () => {
    const name = prompt('New folder name:');
    if (!name) return;
    try { await api('POST', base + '/files/mkdir', { path: (cwd ? cwd + '/' : '') + name }); loadDir(cwd); }
    catch (e) { showMsg(e.message, false); }
  });

  document.getElementById('btnUpload').addEventListener('click', async () => {
    const input = document.getElementById('uploadInput');
    if (!input.files.length) { showMsg('Choose files first.', false); return; }
    const fd = new FormData();
    fd.append('path', cwd);
    for (const f of input.files) fd.append('files', f);
    try {
      const res = await fetch(base + '/files/upload', { method: 'POST', credentials: 'same-origin', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'upload failed');
      showMsg('Uploaded ' + data.count + ' file(s).', true);
      input.value = '';
      loadDir(cwd);
    } catch (e) { showMsg(e.message, false); }
  });

  document.getElementById('fileTable').addEventListener('click', (e) => {
    const fname = e.target.closest('.fname');
    if (fname) {
      if (fname.dataset.dir === 'true') return loadDir(fname.dataset.path);
      return openEditor(fname.dataset.path);
    }
    const edit = e.target.getAttribute('data-edit');
    if (edit) return openEditor(edit);
    const rm = e.target.getAttribute('data-rm');
    if (rm && confirm('Delete "' + rm + '"?')) {
      api('POST', base + '/files/delete', { path: rm })
        .then(() => loadDir(cwd)).catch((err) => showMsg(err.message, false));
    }
  });

  document.getElementById('btnSaveFile').addEventListener('click', async (e) => {
    const p = e.target.dataset.path;
    try {
      await api('POST', base + '/files/save', { path: p, content: document.getElementById('editor').value });
      showMsg('Saved ' + p + '.', true);
    } catch (err) { showMsg(err.message, false); }
  });
  document.getElementById('btnCloseEditor').addEventListener('click', () => {
    document.getElementById('editorCard').classList.add('hidden');
  });

  refreshStatus(); refreshStats(); refreshLogs(); loadDir('');
  setInterval(refreshStatus, 8000);
  setInterval(refreshStats, 8000);
});
