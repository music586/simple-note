const params = new URLSearchParams(window.location.search);

document.getElementById('appVersion').textContent = `v${params.get('appVersion') || '—'}`;
document.getElementById('electronVersion').textContent = params.get('electronVersion') || '—';
document.getElementById('nodeVersion').textContent = params.get('nodeVersion') || '—';
