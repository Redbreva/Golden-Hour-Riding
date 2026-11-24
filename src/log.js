// Local ride log stored in localStorage

const STORAGE_KEY = 'golden-hour-riding-log';
const MIN_METRES = 100;

export function initRideLog({ panel, toggleBtn, courseId = 'valley', getDistance, resetDistance }) {
  const load = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const session = {
    t: new Date().toISOString(),
    c: courseId,
    m: 0,
    s: 0,
  };

  let lastTick = performance.now();
  let storageOk = true;

  function save() {
    const now = performance.now();
    if (!document.hidden) {
      session.s += Math.min(10, (now - lastTick) / 1000);
    }
    lastTick = now;
    session.m = Math.round(getDistance());
    if (session.m < MIN_METRES) return;

    const all = load().filter((r) => r.t !== session.t);
    all.push({ ...session, s: Math.round(session.s) });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-300)));
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }

  const formatKm = (m) => (m / 1000).toFixed(m < 99950 ? 1 : 0);
  const formatDay = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const formatDuration = (sec) =>
    sec < 3600
      ? `${Math.round(sec / 60)} min`
      : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;

  function render() {
    const all = load().filter((r) => r.t !== session.t);
    const dist = getDistance();
    if (dist >= MIN_METRES) all.push({ ...session, m: Math.round(dist) });

    const todayStr = new Date().toDateString();
    const sum = (pred) => all.filter(pred).reduce((acc, r) => acc + r.m, 0);
    const rows = all
      .slice(-10)
      .reverse()
      .map(
        (r) =>
          `<tr><td>${formatDay(r.t)}</td><td class="muted">${r.c === 'leckhampton' ? 'Leckhampton' : 'Valley'}</td><td class="muted">${formatDuration(r.s)}</td><td>${formatKm(r.m)} km</td></tr>`
      )
      .join('');

    panel.innerHTML =
      `<h3>Ride log</h3>` +
      `<div class="totals">` +
      `<div><b>${formatKm(sum((r) => new Date(r.t).toDateString() === todayStr))}</b><span>km today</span></div>` +
      `<div><b>${formatKm(sum(() => true))}</b><span>km total</span></div>` +
      `<div><b>${all.length}</b><span>rides</span></div>` +
      `</div>` +
      (rows ? `<table>${rows}</table>` : `<div class="muted">Rides appear here after 100 m.</div>`) +
      (storageOk ? '' : `<div class="muted" style="margin-top:8px">Local storage is unavailable; log will not persist.</div>`) +
      (all.length ? `<button id="btn-log-clear" type="button">Clear log</button>` : '');

    const clearBtn = document.getElementById('btn-log-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (window.confirm('Delete the entire ride log?')) {
          try { localStorage.removeItem(STORAGE_KEY); } catch {}
          resetDistance();
          session.s = 0;
          render();
        }
      });
    }
  }

  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggleBtn.classList.toggle('on', !panel.hidden);
    if (!panel.hidden) render();
  });

  setInterval(() => {
    save();
    if (!panel.hidden) render();
  }, 5000);

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', save);
}
