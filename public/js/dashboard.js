'use strict';

async function loadServers() {
  const tbody = document.getElementById('serversTable');
  try {
    const { servers } = await api('GET', '/api/servers');
    if (!servers.length) { tbody.innerHTML = '<tr><td class="muted">No servers yet.</td></tr>'; return; }
    tbody.innerHTML = servers.map((s) =>
      '<tr><td><a href="/servers/' + s.id + '">' + esc(s.name) + '</a>' +
      ' <span class="badge ' + esc(s.status) + '">' + esc(s.status) + '</span></td>' +
      '<td class="muted">' + esc(s.server_type) + ' · port ' + s.host_port + '</td></tr>'
    ).join('');
  } catch (e) { tbody.innerHTML = '<tr><td class="muted">' + esc(e.message) + '</td></tr>'; }
}

async function loadRequests() {
  const tbody = document.getElementById('requestsTable');
  try {
    const { requests } = await api('GET', '/api/requests');
    if (!requests.length) { tbody.innerHTML = '<tr><td class="muted">No requests yet.</td></tr>'; return; }
    tbody.innerHTML = requests.map((r) =>
      '<tr><td>' + esc(r.name) + '<br><span class="muted">' + esc(r.server_type) + ' · ' +
      r.ram_mb + 'MB · ' + r.cpu_cores + ' CPU</span></td>' +
      '<td><span class="badge ' + esc(r.status) + '">' + esc(r.status) + '</span>' +
      (r.admin_note ? '<br><span class="muted">' + esc(r.admin_note) + '</span>' : '') + '</td></tr>'
    ).join('');
  } catch (e) { tbody.innerHTML = '<tr><td class="muted">' + esc(e.message) + '</td></tr>'; }
}

document.addEventListener('DOMContentLoaded', () => {
  loadServers();
  loadRequests();

  document.getElementById('requestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      await api('POST', '/api/requests', body);
      showMsg('Request submitted — waiting for admin approval.', true);
      e.target.reset();
      loadRequests();
    } catch (err) { showMsg(err.message, false); }
  });
});
