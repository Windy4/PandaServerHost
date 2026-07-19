'use strict';

async function loadRequests() {
  const tbody = document.getElementById('reqTable');
  try {
    const { requests } = await api('GET', '/api/admin/requests');
    if (!requests.length) { tbody.innerHTML = '<tr><td class="muted">No requests.</td></tr>'; return; }
    tbody.innerHTML = requests.map((r) => {
      const actions = r.status === 'pending'
        ? '<button class="good" data-approve="' + r.id + '">Approve</button> ' +
          '<button class="danger" data-reject="' + r.id + '">Reject</button>'
        : '<span class="muted">' + esc(r.decided_at ? new Date(r.decided_at).toLocaleString() : '') + '</span>';
      return '<tr><td>' + esc(r.owner_username) + '</td><td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.server_type) + '</td><td>' + esc(r.mc_version) + '</td>' +
        '<td>' + r.ram_mb + 'MB</td><td>' + r.cpu_cores + '</td><td>' + r.disk_mb + 'MB</td>' +
        '<td><span class="badge ' + esc(r.status) + '">' + esc(r.status) + '</span></td>' +
        '<td>' + actions + '</td></tr>';
    }).join('');
  } catch (e) { tbody.innerHTML = '<tr><td class="muted">' + esc(e.message) + '</td></tr>'; }
}

async function loadServers() {
  const tbody = document.getElementById('srvTable');
  try {
    const { servers } = await api('GET', '/api/admin/servers');
    if (!servers.length) { tbody.innerHTML = '<tr><td class="muted">No servers.</td></tr>'; return; }
    tbody.innerHTML = servers.map((s) =>
      '<tr><td>' + s.id + '</td><td>' + esc(s.owner_username) + '</td>' +
      '<td><a href="/servers/' + s.id + '">' + esc(s.name) + '</a></td>' +
      '<td>' + esc(s.server_type) + '</td><td><b>' + s.host_port + '</b></td>' +
      '<td class="muted">' + s.ram_mb + 'MB · ' + s.cpu_cores + ' CPU · ' + s.disk_mb + 'MB</td>' +
      '<td><span class="badge ' + esc(s.status) + '">' + esc(s.status) + '</span></td>' +
      '<td class="actions"><div class="actbar">' +
        '<button class="btn-sm" data-edit=\'' + esc(JSON.stringify({ id: s.id, ram: s.ram_mb, cpu: s.cpu_cores, disk: s.disk_mb })) + '\'>Edit</button>' +
        '<button class="btn-sm danger" data-del="' + s.id + '">Delete</button>' +
      '</div></td></tr>'
    ).join('');
  } catch (e) { tbody.innerHTML = '<tr><td class="muted">' + esc(e.message) + '</td></tr>'; }
}

async function loadUsers() {
  const tbody = document.getElementById('userTable');
  try {
    const { users } = await api('GET', '/api/admin/users');
    tbody.innerHTML = users.map((u) =>
      '<tr><td>' + u.id + '</td><td>' + esc(u.username) + '</td>' +
      '<td class="muted">' + esc(u.email || '') + '</td>' +
      '<td><span class="badge ' + (u.role === 'admin' ? 'approved' : '') + '">' + esc(u.role) + '</span></td></tr>'
    ).join('');
  } catch (e) { tbody.innerHTML = '<tr><td class="muted">' + esc(e.message) + '</td></tr>'; }
}

document.addEventListener('DOMContentLoaded', () => {
  loadRequests(); loadServers(); loadUsers();

  document.getElementById('reqTable').addEventListener('click', async (e) => {
    const approve = e.target.getAttribute('data-approve');
    const reject = e.target.getAttribute('data-reject');
    if (approve) {
      e.target.disabled = true;
      showMsg('Deploying server… this can take a minute while the image/jar downloads.', true);
      try {
        const r = await api('POST', '/api/admin/requests/' + approve + '/approve', {});
        showMsg('Approved. Server #' + r.server_id + ' on port ' + r.host_port + ' (' + r.status + ').', true);
      } catch (err) { showMsg(err.message, false); }
      loadRequests(); loadServers();
    } else if (reject) {
      const note = prompt('Reason for rejection (optional):') || '';
      try { await api('POST', '/api/admin/requests/' + reject + '/reject', { note }); } catch (err) { showMsg(err.message, false); }
      loadRequests();
    }
  });

  document.getElementById('srvTable').addEventListener('click', async (e) => {
    const del = e.target.getAttribute('data-del');
    const editRaw = e.target.getAttribute('data-edit');
    if (del && confirm('Delete this server and its container? (Files stay on disk.)')) {
      try { await api('DELETE', '/api/servers/' + del); showMsg('Server deleted.', true); }
      catch (err) { showMsg(err.message, false); }
      loadServers();
    } else if (editRaw) {
      const cur = JSON.parse(editRaw);
      const ram = prompt('RAM in MB (e.g. 4096):', cur.ram);
      if (ram === null) return;
      const cpu = prompt('CPU cores (e.g. 2 or 1.5):', cur.cpu);
      if (cpu === null) return;
      const disk = prompt('Disk in MB (e.g. 10240):', cur.disk);
      if (disk === null) return;
      showMsg('Applying new limits and redeploying… this restarts the server (world is kept).', true);
      try {
        const r = await api('POST', '/api/admin/servers/' + cur.id + '/resources',
          { ram_mb: ram, cpu_cores: cpu, disk_mb: disk });
        showMsg('Updated to ' + r.ram_mb + 'MB · ' + r.cpu_cores + ' CPU · ' + r.disk_mb + 'MB (' + r.status + ').', true);
      } catch (err) { showMsg(err.message, false); }
      loadServers();
    }
  });
});
