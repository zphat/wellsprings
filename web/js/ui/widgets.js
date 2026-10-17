// Shared plugin UI widgets. Every plugin window is built from these so the
// whole grimoire looks like one book.

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// A rotary knob. Drag up/down (shift = fine), wheel, double-click resets.
// Returns { root, set(value) } so the plugin can update it when state changes.
export function knob(parent, { label, min = 0, max = 1, value = 0, step = 0, def = value, onChange, format, size = 46 }) {
  const root = el('div', 'gk-knob');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 50 50');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  const ring = document.createElementNS(svgNS, 'circle');
  ring.setAttribute('cx', 25); ring.setAttribute('cy', 25); ring.setAttribute('r', 20);
  ring.setAttribute('class', 'gk-ring');
  const arc = document.createElementNS(svgNS, 'path');
  arc.setAttribute('class', 'gk-arc');
  const tick = document.createElementNS(svgNS, 'line');
  tick.setAttribute('class', 'gk-tick');
  svg.append(ring, arc, tick);
  const lab = el('div', 'gk-label', label);
  const val = el('div', 'gk-value');
  root.append(svg, lab, val);
  parent.appendChild(root);

  let v = value;
  const fmt = format || (x => (Math.abs(max - min) <= 2 ? x.toFixed(2) : Math.round(x)));
  const norm = x => (x - min) / (max - min);
  function draw() {
    const a0 = -135, a = a0 + norm(v) * 270;
    const p = deg => [25 + 20 * Math.sin(deg * Math.PI / 180), 25 - 20 * Math.cos(deg * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a);
    arc.setAttribute('d', `M${x0},${y0} A20,20 0 ${a - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`);
    const [tx, ty] = [25 + 13 * Math.sin(a * Math.PI / 180), 25 - 13 * Math.cos(a * Math.PI / 180)];
    tick.setAttribute('x1', 25); tick.setAttribute('y1', 25);
    tick.setAttribute('x2', tx); tick.setAttribute('y2', ty);
    val.textContent = fmt(v);
  }
  function commit(x) {
    x = Math.min(max, Math.max(min, x));
    if (step) x = Math.round(x / step) * step;
    if (x === v) return;
    v = x; draw(); onChange && onChange(v);
  }
  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const startY = e.clientY, startV = v;
    const move = ev => commit(startV + (startY - ev.clientY) / (ev.shiftKey ? 600 : 150) * (max - min));
    const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });
  svg.addEventListener('wheel', e => { e.preventDefault(); commit(v - Math.sign(e.deltaY) * (step || (max - min) / 100)); }, { passive: false });
  svg.addEventListener('dblclick', () => commit(def));
  draw();
  return { root, set(x) { v = x; draw(); }, get: () => v };
}

export function select(parent, { label, options, value, onChange }) {
  const root = el('label', 'gk-select');
  if (label) root.appendChild(el('span', 'gk-label', label));
  const s = el('select');
  for (const o of options) {
    const opt = el('option', null, typeof o === 'string' ? o : o.label);
    opt.value = typeof o === 'string' ? o : o.value;
    s.appendChild(opt);
  }
  s.value = value;
  s.addEventListener('change', () => onChange && onChange(s.value));
  root.appendChild(s);
  parent.appendChild(root);
  return { root, set(x) { s.value = x; } };
}

export function toggle(parent, { label, value, onChange }) {
  const b = el('button', 'gk-toggle' + (value ? ' on' : ''), label);
  let v = !!value;
  b.addEventListener('click', () => { v = !v; b.classList.toggle('on', v); onChange && onChange(v); });
  parent.appendChild(b);
  return { root: b, set(x) { v = !!x; b.classList.toggle('on', v); } };
}

export function button(parent, label, onClick, cls = '') {
  const b = el('button', 'gk-btn ' + cls, label);
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

// A titled row of controls inside a plugin window.
export function section(parent, title) {
  const s = el('div', 'gk-section');
  if (title) s.appendChild(el('div', 'gk-section-title', title));
  const row = el('div', 'gk-row');
  s.appendChild(row);
  parent.appendChild(s);
  return row;
}

// Small live meter fed by an AnalyserNode. Returns a stop() function.
export function meter(parent, analyser, { width = 120, height = 10 } = {}) {
  const c = el('canvas', 'gk-meter');
  c.width = width; c.height = height;
  parent.appendChild(c);
  const g = c.getContext('2d');
  const buf = new Float32Array(analyser.fftSize);
  let raf;
  (function loop() {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const x of buf) peak = Math.max(peak, Math.abs(x));
    g.clearRect(0, 0, width, height);
    g.fillStyle = peak > 0.98 ? '#ff4a6a' : '#9dff8a';
    g.fillRect(0, 0, Math.min(1, peak) * width, height);
    raf = requestAnimationFrame(loop);
  })();
  return () => cancelAnimationFrame(raf);
}
