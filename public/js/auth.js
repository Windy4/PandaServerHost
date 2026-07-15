'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('authForm');
  const mode = form.dataset.mode;
  const msg = document.getElementById('msg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    const url = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      window.location.href = '/dashboard';
    } catch (err) {
      msg.innerHTML = '<div class="notice err">' + err.message + '</div>';
    }
  });
});
