// Floating, draggable plugin windows (like FL's plugin wrappers).
import { el } from './widgets.js';

const open = new Map();
let z = 40, cascade = 0;

export function openWindow(key, title, build, { onClose } = {}) {
  if (open.has(key)) { const w = open.get(key); w.style.zIndex = ++z; return w; }
  const w = el('div', 'win');
  const bar = el('div', 'win-bar');
  const t = el('div', 'win-title', title);
  const x = el('button', 'tb-btn', '✕');
  x.title = 'Close (Esc)';
  bar.append(t, x);
  const body = el('div', 'win-body');
  w.append(bar, body);
  const off = (cascade++ % 6) * 24;
  w.style.left = Math.max(8, Math.min(window.innerWidth - 340, 120 + off)) + 'px';
  w.style.top = 90 + off + 'px';
  w.style.zIndex = ++z;
  document.getElementById('windows').appendChild(w);
  build(body, w);
  const close = () => { w.remove(); open.delete(key); onClose && onClose(); };
  x.onclick = close;
  w.close = close;
  w.addEventListener('pointerdown', () => (w.style.zIndex = ++z));
  bar.addEventListener('pointerdown', e => {
    if (e.target === x) return;
    const sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop;
    const mv = ev => { w.style.left = Math.max(0, ev.clientX - sx) + 'px'; w.style.top = Math.max(0, ev.clientY - sy) + 'px'; };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  open.set(key, w);
  return w;
}

export function closeTopWindow() {
  let top = null;
  for (const w of open.values()) if (!top || +w.style.zIndex > +top.style.zIndex) top = w;
  if (top) { top.close(); return true; }
  return false;
}

export function closeAll() { for (const w of [...open.values()]) w.close(); }

// Opens a live plugin's UI in a window. `where` is passed to engine.livePlugin.
export function openPluginWindow(app, where, title) {
  const key = JSON.stringify(where);
  return openWindow(key, title, body => {
    const p = app.engine.livePlugin(where);
    if (!p) { body.textContent = 'Plugin not loaded.'; return; }
    const root = el('div', `gk-plugin gk-plugin-${p.id}`);
    body.appendChild(root);
    p.renderUI(root);
  });
}
