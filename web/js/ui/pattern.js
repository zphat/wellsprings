// Pattern screen: channel rack (step sequencer) on top, piano roll below.
// The roll bends and breathes on purpose. Hit-testing uses the same warp
// function as drawing, so clicks always land on the note you see.
import { store, settings, newPattern, newChannel, PATTERN_COLORS, uid } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';
import { inKey, isRoot, noteName, snapToKey, NOTE_NAMES, SCALES } from '../theory.js';
import { openPluginWindow } from './windows.js';
import { SOUNDS } from '../audio/soundbank.js';

const ROW_H = 14, KEYS_W = 56, VEL_H = 46, LOW = 24, HIGH = 108;
let root, rackEl, rollWrap, canvas, g;
let stepW = 20, scrollX = 0, scrollY = (HIGH - 76) * ROW_H;
let selection = new Set(), lastLen = 2, playStep = -1, cursorStep = 0;
let drag = null, hover = null, raf = 0, t0 = performance.now();

export function mount(container) {
  root = container;
  root.innerHTML = '';
  const wrap = el('div', 'pattern-wrap');
  rackEl = el('div', 'rack');
  rollWrap = el('div', 'roll-wrap');
  canvas = el('canvas');
  rollWrap.appendChild(canvas);
  rollWrap.appendChild(rollTools());
  wrap.append(rackEl, rollWrap);
  root.appendChild(wrap);
  g = canvas.getContext('2d');
  bindRoll();
  renderRack();
  syncTools();
  let lastFocus = '';
  store.on(w => {
    if (w === 'all' || w === 'pattern' || w === 'settings') { renderRack(); syncTools(); }
    // when the channel or pattern changes, scroll the roll to where its notes are
    const f = store.project.selectedChannel + store.project.currentPattern;
    if (f !== lastFocus) { lastFocus = f; focusNotes(); }
  });
  new ResizeObserver(resize).observe(rollWrap);
  return { shown() { resize(); loop(); }, setPlayStep, recordNote, stampChord, selectedNotes: () => [...selection] };
}

// --- rack ---------------------------------------------------------------------

function renderRack() {
  const p = store.project, pat = store.pattern();
  if (!pat) return;
  rackEl.innerHTML = '';
  rackEl.classList.toggle('sway', !settings.reducedMotion);
  const head = el('div', 'rack-head');
  head.appendChild(el('span', 'rack-title', 'Channel Rack'));
  const sel = el('select', 'tb-field');
  for (const x of p.patterns) { const o = el('option', null, x.name); o.value = x.id; sel.appendChild(o); }
  sel.value = pat.id;
  sel.onchange = () => { store.project.currentPattern = sel.value; selection.clear(); store.emit('pattern'); };
  sel.title = 'Current pattern ( - / + to switch )';
  head.appendChild(sel);
  const btn = (label, title, fn) => { const b = el('button', 'tb-btn', label); b.title = title; b.onclick = fn; head.appendChild(b); return b; };
  btn('+', 'New pattern', () => app.change('New pattern', pr => {
    const np = newPattern(`Pattern ${pr.patterns.length + 1}`, PATTERN_COLORS[pr.patterns.length % PATTERN_COLORS.length]);
    pr.patterns.push(np); pr.currentPattern = np.id;
  }));
  btn('⧉', 'Clone pattern', () => app.change('Clone pattern', pr => {
    const src = pr.patterns.find(x => x.id === pr.currentPattern);
    const np = JSON.parse(JSON.stringify(src)); np.id = uid('pt'); np.name = src.name + ' ✶';
    pr.patterns.push(np); pr.currentPattern = np.id;
  }));
  btn('✎', 'Rename pattern', () => {
    const n = prompt('Pattern name', pat.name);
    if (n) app.change('Rename pattern', pr => { pr.patterns.find(x => x.id === pat.id).name = n; });
  });
  btn('✂ Split', 'Split by instrument: one pattern per channel, and the playlist gets one track per instrument', () => {
    if (splitPattern(pat.id)) app.toast(`Split "${pat.name}" into one pattern per instrument. Check the playlist (F5).`);
    else app.toast('Only one instrument in this pattern, nothing to split.');
  });
  btn('🗑', 'Delete pattern (and its clips in the playlist)', () => {
    if (store.project.patterns.length < 2) { app.toast('Keep at least one pattern.'); return; }
    if (!confirm(`Delete "${pat.name}" and its playlist clips? (Ctrl+Z brings it back)`)) return;
    app.change('Delete pattern', pr => {
      pr.patterns = pr.patterns.filter(x => x.id !== pat.id);
      pr.arrangement.clips = pr.arrangement.clips.filter(c => c.patternId !== pat.id);
      pr.currentPattern = pr.patterns[0].id;
    });
  });
  const len = el('select', 'tb-field');
  for (const n of [16, 32, 48, 64, 128]) { const o = el('option', null, `${n / 16} bar${n > 16 ? 's' : ''}`); o.value = n; len.appendChild(o); }
  len.value = pat.length;
  len.title = 'Pattern length';
  len.onchange = () => app.change('Pattern length', pr => { pr.patterns.find(x => x.id === pat.id).length = +len.value; });
  head.appendChild(len);
  btn('+ Channel', 'Add a channel from the sound bank (F8 for the full bank)', () => app.show('browser'));
  btn('+ Sigil', 'Add a Sigil synth channel', () => app.change('Add Sigil', pr => {
    const c = newChannel(`Sigil ${pr.channels.length + 1}`, { type: 'plugin', pluginId: 'sigil', state: null }, nextMixer(pr));
    pr.channels.push(c); pr.selectedChannel = c.id;
  }));
  rackEl.appendChild(head);

  const anySolo = p.channels.some(c => c.solo);
  for (const c of p.channels) {
    const row = el('div', 'rack-row' + (c.id === p.selectedChannel ? ' selected' : ''));
    const mute = el('button', 'ch-led' + (!c.mute && (!anySolo || c.solo) ? ' on' : ''));
    mute.title = 'Mute (right-click: solo)';
    mute.onclick = () => app.change('Mute', pr => { const x = pr.channels.find(y => y.id === c.id); x.mute = !x.mute; });
    mute.oncontextmenu = e => { e.preventDefault(); app.change('Solo', pr => { const x = pr.channels.find(y => y.id === c.id); x.solo = !x.solo; }); };
    const route = el('button', 'ch-led', '');
    route.style.cssText = 'border-radius:3px;font-size:9px;width:20px;color:var(--dim)';
    route.textContent = c.mixer;
    route.title = `Mixer insert ${c.mixer} (click to change)`;
    route.onclick = () => {
      const n = prompt('Route to mixer insert (0 = master)', c.mixer);
      if (n != null && !isNaN(+n)) app.change('Route channel', pr => { pr.channels.find(y => y.id === c.id).mixer = Math.max(0, Math.min(16, +n)); });
    };
    const name = el('button', 'ch-name', c.name);
    name.title = 'Click: select · Double-click: open instrument · Right-click: options';
    name.onclick = () => { store.project.selectedChannel = c.id; store.emit('pattern'); };
    name.ondblclick = () => openPluginWindow(app, { channel: c.id }, c.name);
    name.oncontextmenu = e => { e.preventDefault(); channelMenu(c); };
    const steps = el('div', 'steps');
    const arr = pat.steps[c.id] || [];
    const hasNotes = (pat.notes[c.id] || []).length > 0;
    for (let s = 0; s < pat.length; s++) {
      const b = el('button', 'step' + (s % 4 === 0 ? ' beat' : '') + (s % 16 === 0 && s ? ' bar' : '') + (arr[s] ? ' on' : '') + (hasNotes && !arr[s] ? ' has-notes' : ''));
      b.dataset.step = s;
      if (arr[s] && typeof arr[s] === 'number') b.style.opacity = 0.45 + arr[s] * 0.55;
      b.onclick = e => app.change('Step', pr => {
        const pp = pr.patterns.find(x => x.id === pat.id);
        const a = pp.steps[c.id] || (pp.steps[c.id] = []);
        a[s] = a[s] ? 0 : (e.shiftKey ? 1 : 0.8);
      });
      b.oncontextmenu = e => { e.preventDefault(); app.engine.previewNote(c.id, c.source.pitch || 60); };
      steps.appendChild(b);
    }
    row.append(mute, route, name, steps);
    rackEl.appendChild(row);
  }
}

function nextMixer(pr) {
  const used = new Set(pr.channels.map(c => c.mixer));
  for (let i = 1; i <= 16; i++) if (!used.has(i)) return i;
  return 0;
}

function channelMenu(c) {
  const choice = prompt(`${c.name}\n1 rename · 2 delete · 3 clone · 4 change sound (random in category) · 5 move up\nType a number:`);
  if (choice === '1') { const n = prompt('Channel name', c.name); if (n) app.change('Rename channel', pr => { pr.channels.find(x => x.id === c.id).name = n; }); }
  if (choice === '2') app.change('Delete channel', pr => {
    pr.channels = pr.channels.filter(x => x.id !== c.id);
    for (const pt of pr.patterns) { delete pt.steps[c.id]; delete pt.notes[c.id]; }
    if (pr.selectedChannel === c.id) pr.selectedChannel = pr.channels[0]?.id;
  });
  if (choice === '3') app.change('Clone channel', pr => {
    const x = JSON.parse(JSON.stringify(pr.channels.find(y => y.id === c.id))); x.id = uid('ch'); x.name += ' 2';
    pr.channels.push(x);
  });
  if (choice === '4' && c.source.type === 'sound') {
    const cur = SOUNDS.find(s => s.id === c.source.soundId);
    const pool = SOUNDS.filter(s => s.category === cur?.category && s.id !== c.source.soundId);
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (next) app.change(`Sound → ${next.name}`, pr => { const x = pr.channels.find(y => y.id === c.id); x.source = { type: 'sound', soundId: next.id }; x.name = next.name; });
  }
  if (choice === '5') app.change('Move channel', pr => {
    const i = pr.channels.findIndex(x => x.id === c.id);
    if (i > 0) [pr.channels[i - 1], pr.channels[i]] = [pr.channels[i], pr.channels[i - 1]];
  });
}

// --- roll toolbar ------------------------------------------------------------------

let toolEls = {};
function rollTools() {
  const t = el('div', 'roll-tools');
  const chip = (key, label, title, fn) => { const b = el('button', 'chip', label); b.title = title; b.onclick = fn; t.appendChild(b); toolEls[key] = b; return b; };
  chip('hl', 'Key highlight', 'Tint the rows that are in the key', () => { settings.highlightKey = !settings.highlightKey; save(); });
  chip('snap', 'Snap to key', 'New notes and the computer keyboard land only on in-key notes', () => { settings.snapToKey = !settings.snapToKey; save(); });
  chip('warp', 'Warp', 'Click to cycle how hard the roll bends (uneasy / haunted / possessed). It never goes straight.', () => {
    const i = WARP_LEVELS.findIndex(x => x >= settings.warp - 0.01);
    settings.warp = WARP_LEVELS[(i + 1) % WARP_LEVELS.length]; save();
  });
  chip('key', '', 'Change the key in the top bar', () => document.getElementById('tb-key')?.focus());
  return t;
}
function save() { import('../state.js').then(m => m.saveSettings()); }
function syncTools() {
  if (!toolEls.hl) return;
  toolEls.hl.classList.toggle('on', settings.highlightKey);
  toolEls.snap.classList.toggle('on', settings.snapToKey);
  toolEls.warp.classList.add('on');
  toolEls.warp.textContent = 'Warp: ' + WARP_NAMES[Math.max(0, WARP_LEVELS.findIndex(x => x >= settings.warp - 0.01))];
  const k = store.project.key;
  toolEls.key.textContent = `${NOTE_NAMES[k.root]} ${k.scale}`;
}

// --- warp -----------------------------------------------------------------------------
// The roll is never straight. Everything below is one offset field off(x, y):
// drifting waves, a slow tilt and twist, breathing, a squash on every beat, a lens
// that swells around the cursor, ripples from clicks, and the odd screen tear.
// unwarp() inverts the same field, so a click always lands on the note you see.

export const WARP_LEVELS = [0.35, 0.65, 1];
export const WARP_NAMES = ['uneasy', 'haunted', 'possessed'];
let mouse = null, ripples = [], pulseAt = -1e9, tear = null, nextTearAt = 0;

const hueDrift = () => 110 + 40 * Math.sin((performance.now() - t0) / 9990);

function warpFns() {
  const a = Math.max(WARP_LEVELS[0], Math.min(1, settings.warp || 0));
  const speed = settings.reducedMotion ? 0.3 : 1;
  const now = performance.now();
  const t = (now - t0) / 1000 * speed;
  const W = canvas.clientWidth, H = canvas.clientHeight - VEL_H;
  const cx = W / 2, cy = H / 2;
  const tilt = a * 0.022 * Math.sin(t * 0.21);
  const twist = a * 0.014 * Math.sin(t * 0.13 + 1);
  const breathe = a * 0.014 * Math.sin(t * 0.7);
  const pulse = settings.reducedMotion ? 0 : Math.exp(-(now - pulseAt) / 120) * a * 0.035;
  const rip = ripples.filter(r => now - r.t < 2400);
  const lens = mouse ? a * 0.32 : 0;
  if (!settings.reducedMotion && now > nextTearAt) {
    nextTearAt = now + 2500 + Math.random() * 9990;
    if (Math.random() < 0.6 * a) tear = { y: Math.random() * H, h: 6 + Math.random() * 26, shift: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 16 * a), until: now + 90 + Math.random() * 140 };
  }
  const tr = tear && now < tear.until ? tear : null;

  function off(x, y) {
    let ox = a * 4 * Math.sin(y / 85 + t * 0.8) + a * 2 * Math.sin(y / 31 - t * 1.7);
    let oy = a * 9 * Math.sin(x / 170 + t * 0.55) + a * 3.5 * Math.sin(x / 47 - t * 1.3) + tilt * (x - cx);
    const rx = x - cx, ry = y - cy;
    ox += -twist * ry + rx * breathe;
    oy += twist * rx + ry * (breathe + pulse);
    if (lens) {
      const mx = x - mouse.x, my = y - mouse.y;
      const f = lens * Math.exp(-(mx * mx + my * my) / 4900);
      ox += mx * f; oy += my * f;
    }
    for (const r of rip) {
      const age = (now - r.t) / 1000, ddx = x - r.x, ddy = y - r.y, d = Math.hypot(ddx, ddy) || 1;
      const amp = a * 6 * Math.exp(-age * 1.8) * Math.exp(-d / 240) * Math.sin(d / 18 - age * 13);
      ox += ddx / d * amp; oy += ddy / d * amp;
    }
    if (tr && y > tr.y && y < tr.y + tr.h) ox += tr.shift;
    return [ox, oy];
  }
  return { off };
}

// screen point -> roll coordinates, by fixed-point iteration on the offset field
function unwarp(mx, my) {
  const { off } = warpFns();
  let x = mx, y = my;
  for (let i = 0; i < 6; i++) { const o = off(x, y); x = mx - o[0]; y = my - o[1]; }
  return { x, y };
}

// Faint seals turning slowly behind the grid. Nine points, for 9990.
function drawSigils(W, H) {
  const t = (performance.now() - t0) / 1000;
  g.save();
  g.globalAlpha = 0.07;
  g.strokeStyle = '#ff8adf';
  g.lineWidth = 1;
  const spots = [[0.25, 0.3, 90], [0.7, 0.65, 130], [0.9, 0.2, 60]];
  spots.forEach(([fx, fy, r], k) => {
    const cx = fx * W, cy = fy * H, rot = t * (k % 2 ? -0.05 : 0.07);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * 0.82, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let i = 0; i <= 9; i++) {
      const ang = rot + (i * 4 % 9) / 9 * Math.PI * 2; // nine-pointed star, skipping four
      g.lineTo(cx + Math.cos(ang) * r * 0.8, cy + Math.sin(ang) * r * 0.8);
    }
    g.stroke();
  });
  g.globalAlpha = 0.09; g.fillStyle = '#ffd78a'; g.font = '28px VT323, monospace';
  g.fillText('9990', W * 0.7 - 24, H * 0.65 + 9);
  g.restore();
}

const xToStep = x => (x - KEYS_W + scrollX) / stepW;
const yToPitch = y => HIGH - Math.floor((y + scrollY) / ROW_H);
const stepToX = s => KEYS_W + s * stepW - scrollX;
const pitchToY = m => (HIGH - m) * ROW_H - scrollY;

// --- drawing ----------------------------------------------------------------------------

function resize() {
  const r = rollWrap.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampScroll();
}
function clampScroll() {
  const h = canvas.clientHeight - VEL_H;
  scrollY = Math.max(0, Math.min((HIGH - LOW + 1) * ROW_H - h, scrollY));
  scrollX = Math.max(0, scrollX);
}

function loop() {
  cancelAnimationFrame(raf);
  const frame = () => {
    if (app.current !== 'pattern') return;
    draw();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

// Warped drawing helpers: every point goes through the same offset field
// that unwarp() inverts for the mouse.
function warpedRect(x0, y0, x1, y1, W) {
  g.beginPath();
  const n = Math.max(2, Math.ceil((x1 - x0) / 8));
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, o = W.off(x, y0); g.lineTo(x + o[0], y0 + o[1]); }
  for (let i = n; i >= 0; i--) { const x = x0 + (x1 - x0) * i / n, o = W.off(x, y1); g.lineTo(x + o[0], y1 + o[1]); }
  g.closePath();
}
function warpedHLine(x0, x1, y, W) {
  g.beginPath();
  for (let x = x0; x <= x1 + 12; x += 12) { const o = W.off(x, y); g.lineTo(x + o[0], y + o[1]); }
  g.stroke();
}
function warpedVLine(x, y0, y1, W) {
  g.beginPath();
  for (let y = y0; y <= y1 + 12; y += 12) { const o = W.off(x, y); g.lineTo(x + o[0], y + o[1]); }
  g.stroke();
}

function draw() {
  const Wd = canvas.clientWidth, H = canvas.clientHeight, gridH = H - VEL_H;
  const p = store.project, pat = store.pattern(), ch = store.channel();
  const W = warpFns();
  g.fillStyle = '#05070a'; g.fillRect(0, 0, Wd, H);
  if (!pat || !ch) return;
  drawSigils(Wd, H - VEL_H);
  const key = p.key;
  const first = Math.max(LOW, yToPitch(gridH)), last = Math.min(HIGH, yToPitch(0));

  // rows
  g.save();
  g.beginPath(); g.rect(KEYS_W - 20, 0, Wd, gridH); g.clip();
  for (let m = first - 1; m <= last + 1; m++) {
    const y = pitchToY(m);
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    let fill = black ? '#080a0f' : '#0c0f15';
    if (settings.highlightKey && inKey(m, key)) fill = isRoot(m, key) ? 'rgba(255,215,138,.17)' : `hsla(${hueDrift()},100%,70%,.075)`;
    if (settings.highlightKey && !inKey(m, key)) fill = '#040508';
    g.fillStyle = fill;
    warpedRect(KEYS_W, y, Wd + 20, y + ROW_H, W); g.fill();
  }
  // grid lines
  const firstStep = Math.floor(scrollX / stepW), lastStep = firstStep + Math.ceil(Wd / stepW) + 1;
  for (let s = firstStep; s <= lastStep; s++) {
    const x = stepToX(s);
    g.strokeStyle = s % 16 === 0 ? 'rgba(255,215,138,.35)' : s % 4 === 0 ? 'rgba(157,255,138,.14)' : 'rgba(255,255,255,.04)';
    g.lineWidth = s % 16 === 0 ? 1.5 : 1;
    warpedVLine(x, 0, gridH, W);
  }
  g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1;
  for (let m = first; m <= last + 1; m++) warpedHLine(KEYS_W, Wd, pitchToY(m), W);
  // pattern end
  g.fillStyle = 'rgba(0,0,0,.45)';
  const endX = stepToX(pat.length);
  if (endX < Wd) { warpedRect(endX, 0, Wd + 20, gridH, W); g.fill(); }

  // ghost notes from other channels
  for (const c of p.channels) {
    if (c.id === ch.id) continue;
    for (const n of pat.notes[c.id] || []) {
      const y = pitchToY(n.m); if (y < -ROW_H || y > gridH) continue;
      g.fillStyle = 'rgba(138,216,255,.08)';
      warpedRect(stepToX(n.t), y + 2, stepToX(n.t + n.d), y + ROW_H - 2, W); g.fill();
    }
  }
  // notes, with a little chromatic split when warped
  const notes = pat.notes[ch.id] || [];
  const split = settings.warp * 1.6;
  notes.forEach((n, i) => {
    const y = pitchToY(n.m); if (y < -ROW_H || y > gridH) return;
    const x0 = stepToX(n.t), x1 = stepToX(n.t + n.d);
    if (x1 < KEYS_W || x0 > Wd) return;
    const sel = selection.has(i);
    if (split > 0.2) {
      g.fillStyle = 'rgba(255,90,140,.35)'; warpedRect(x0 - split, y + 1, x1 - split, y + ROW_H - 1, W); g.fill();
      g.fillStyle = 'rgba(90,220,255,.35)'; warpedRect(x0 + split, y + 1, x1 + split, y + ROW_H - 1, W); g.fill();
    }
    const a = 0.55 + 0.45 * (n.v ?? 0.85);
    const sounding = playStep >= 0 && playStep >= n.t && playStep < n.t + n.d;
    g.shadowBlur = sounding ? 18 : 0; g.shadowColor = '#ff8adf';
    g.fillStyle = sounding ? '#ffe3f6' : sel ? `rgba(255,215,138,${a})` : `rgba(255,138,223,${a})`;
    warpedRect(x0, y + 1, x1, y + ROW_H - 1, W); g.fill();
    g.strokeStyle = sel ? '#fff3d0' : '#ffd0f2'; g.lineWidth = 1; g.stroke();
    g.shadowBlur = 0;
    if (settings.showNoteNames && x1 - x0 > 26) {
      g.fillStyle = '#1a0614'; g.font = '10px IBM Plex Mono, monospace';
      const o = W.off(x0, y + ROW_H - 3);
      g.fillText(noteName(n.m), x0 + 3 + o[0], y + ROW_H - 3 + o[1]);
    }
  });
  // playhead
  if (playStep >= 0) {
    const x = stepToX(playStep % pat.length);
    g.strokeStyle = 'rgba(157,255,138,.9)'; g.lineWidth = 2; warpedVLine(x, 0, gridH, W);
  }
  // edit cursor
  g.strokeStyle = 'rgba(255,215,138,.5)'; g.setLineDash([3, 4]); g.lineWidth = 1;
  warpedVLine(stepToX(cursorStep), 0, gridH, W); g.setLineDash([]);
  g.restore();

  // piano keys (they stay straight, they're your anchor)
  for (let m = first - 1; m <= last + 1; m++) {
    const y = pitchToY(m);
    if (y > gridH) continue;
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    let fill = black ? '#14161c' : '#cfd6cc';
    if (settings.highlightKey && inKey(m, key)) fill = black ? '#3b5a33' : '#d9ffcf';
    if (settings.highlightKey && isRoot(m, key)) fill = '#ffd78a';
    if (hover && hover.pitch === m) fill = '#ff8adf';
    g.fillStyle = fill; g.fillRect(0, y, KEYS_W - 2, ROW_H - 1);
    if (m % 12 === 0 || isRoot(m, key)) { g.fillStyle = '#111'; g.font = '10px IBM Plex Mono, monospace'; g.fillText(noteName(m), 4, y + ROW_H - 3); }
  }

  // velocity lane
  g.fillStyle = '#0a0c12'; g.fillRect(0, gridH, Wd, VEL_H);
  g.fillStyle = '#7d8794'; g.font = '10px IBM Plex Mono, monospace'; g.fillText('velocity', 4, gridH + 14);
  notes.forEach((n, i) => {
    const x = stepToX(n.t); if (x < KEYS_W || x > Wd) return;
    const h = (VEL_H - 8) * (n.v ?? 0.85);
    g.fillStyle = selection.has(i) ? '#ffd78a' : '#ff8adf';
    g.fillRect(x, H - 4 - h, 3, h);
  });
  g.strokeStyle = '#232838'; g.beginPath(); g.moveTo(0, gridH + 0.5); g.lineTo(Wd, gridH + 0.5); g.stroke();
}

// --- interaction --------------------------------------------------------------------------

function hitNote(step, pitch) {
  const notes = store.pattern().notes[store.project.selectedChannel] || [];
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.m === pitch && step >= n.t && step < n.t + n.d) return { i, n, edge: (n.t + n.d - step) * stepW < 7 };
  }
  return null;
}

function bindRoll() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    const { x, y } = unwarp(e.clientX - r.left, e.clientY - r.top);
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    hover = { step: xToStep(x), pitch: yToPitch(y) };
    if (!drag) {
      const h = x > KEYS_W && y < canvas.clientHeight - VEL_H ? hitNote(hover.step, hover.pitch) : null;
      canvas.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'crosshair';
    }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; mouse = null; });
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const { x, y } = unwarp(e.clientX - r.left, e.clientY - r.top);
    const H = canvas.clientHeight;
    ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() });
    if (ripples.length > 6) ripples.shift();
    const ch = store.channel(); if (!ch) return;
    const pat = store.pattern();
    // velocity lane
    if (e.clientY - r.top > H - VEL_H) { velDrag(e, r); return; }
    // keyboard strip: audition
    if (x < KEYS_W) { app.engine.previewNote(ch.id, yToPitch(y)); return; }
    const step = xToStep(x), pitch = yToPitch(y);
    const snap = e.altKey ? 0.25 : 1;
    const h = hitNote(step, pitch);
    if (e.button === 2) { // delete
      if (h) app.change('Delete note', pr => { pr.patterns.find(p => p.id === pat.id).notes[ch.id].splice(h.i, 1); selection.clear(); });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    cursorStep = Math.floor(step / snap) * snap;
    if (h) {
      if (e.ctrlKey || e.metaKey) { selection.has(h.i) ? selection.delete(h.i) : selection.add(h.i); return; }
      if (!selection.has(h.i)) { selection.clear(); selection.add(h.i); }
      // snapshot once, then edit live; the undo entry is the pre-drag state
      store.mutate(h.edge ? 'Resize note' : 'Move notes', () => { }, 'none');
      const notes = store.pattern().notes[ch.id];
      const orig = [...selection].map(i => ({ i, ...notes[i] }));
      drag = { kind: h.edge ? 'resize' : 'move', step, pitch, orig, snap, lastPitch: pitch };
      app.engine.previewNote(ch.id, h.n.m, 0.15);
    } else {
      selection.clear();
      let m = pitch;
      if (settings.snapToKey) m = snapToKey(m, store.project.key);
      const t = Math.floor(step / snap) * snap;
      store.mutate('Add note', pr => {
        const pp = pr.patterns.find(p => p.id === pat.id);
        (pp.notes[ch.id] || (pp.notes[ch.id] = [])).push({ t, d: lastLen, m, v: 0.85 });
        selection.add(pp.notes[ch.id].length - 1);
      });
      app.engine.previewNote(ch.id, m, 0.2);
      const notes = store.pattern().notes[ch.id];
      drag = { kind: 'resize', step: t, pitch: m, orig: [{ i: notes.length - 1, ...notes[notes.length - 1] }], snap, fresh: true };
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const { x, y } = unwarp(e.clientX - r.left, e.clientY - r.top);
    const step = xToStep(x), pitch = yToPitch(y);
    const notes = store.pattern().notes[store.project.selectedChannel];
    const ds = Math.round((step - drag.step) / drag.snap) * drag.snap;
    if (drag.kind === 'move') {
      let dp = pitch - drag.pitch;
      for (const o of drag.orig) {
        const n = notes[o.i]; if (!n) continue;
        n.t = Math.max(0, o.t + ds);
        n.m = Math.max(LOW, Math.min(HIGH, settings.snapToKey ? snapToKey(o.m + dp, store.project.key) : o.m + dp));
      }
      if (pitch !== drag.lastPitch) { app.engine.previewNote(store.project.selectedChannel, notes[drag.orig[0].i].m, 0.12); drag.lastPitch = pitch; }
    } else {
      for (const o of drag.orig) {
        const n = notes[o.i]; if (!n) continue;
        const end = drag.fresh ? Math.max(o.t + drag.snap, Math.ceil(step / drag.snap) * drag.snap) : o.t + o.d + ds;
        n.d = Math.max(drag.snap / 2, end - o.t);
        lastLen = n.d;
      }
    }
  });
  const end = () => { if (drag) { drag = null; store.emit('pattern'); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) { stepW = Math.max(6, Math.min(60, stepW * (e.deltaY < 0 ? 1.12 : 0.89))); }
    else if (e.shiftKey) scrollX += e.deltaY;
    else { scrollY += e.deltaY; scrollX += e.deltaX; }
    clampScroll();
  }, { passive: false });
}

function velDrag(e, r) {
  const notes = store.pattern().notes[store.project.selectedChannel] || [];
  store.mutate('Velocity', () => { }, 'none');
  const apply = ev => {
    const x = ev.clientX - r.left, step = xToStep(x);
    const v = Math.max(0.05, Math.min(1, (r.bottom - 4 - ev.clientY) / (VEL_H - 8)));
    notes.forEach((n, i) => {
      if (Math.abs(n.t - step) < 0.6 && (!selection.size || selection.has(i) || Math.abs(n.t - step) < 0.6)) n.v = v;
    });
  };
  apply(e);
  const up = () => { removeEventListener('pointermove', apply); removeEventListener('pointerup', up); };
  addEventListener('pointermove', apply); addEventListener('pointerup', up);
}

// keyboard helpers called from keyboard.js
export function deleteSelection() {
  if (!selection.size || app.current !== 'pattern') return false;
  const ids = new Set(selection);
  app.change('Delete notes', pr => {
    const pp = pr.patterns.find(p => p.id === pr.currentPattern);
    pp.notes[pr.selectedChannel] = (pp.notes[pr.selectedChannel] || []).filter((_, i) => !ids.has(i));
  });
  selection.clear();
  return true;
}
export function selectAll() {
  const notes = store.pattern().notes[store.project.selectedChannel] || [];
  selection = new Set(notes.map((_, i) => i));
}
export function transposeSelection(semi) {
  if (!selection.size) return false;
  app.change('Transpose', pr => {
    const notes = pr.patterns.find(p => p.id === pr.currentPattern).notes[pr.selectedChannel];
    for (const i of selection) if (notes[i]) notes[i].m += semi;
  });
  return true;
}

function setPlayStep(s) {
  if (s >= 0 && s % 4 === 0 && s !== playStep) pulseAt = performance.now();
  playStep = s;
}

function focusNotes() {
  const notes = store.pattern()?.notes[store.project.selectedChannel] || [];
  const h = (canvas?.clientHeight || 400) - VEL_H;
  const mid = notes.length ? notes.reduce((s, n) => s + n.m, 0) / notes.length : 12 * (store.ui.octave + 1) + 6;
  scrollY = (HIGH - mid) * ROW_H - h / 2;
  scrollX = 0;
  clampScroll();
}

// Recording from the computer keyboard / MIDI: called when a key is released.
function recordNote(chId, midi, startStep, endStep, vel = 0.85) {
  const pat = store.pattern();
  const t = Math.round(startStep) % pat.length;
  const d = Math.max(1, Math.round(endStep - startStep));
  store.mutate('Record note', pr => {
    const pp = pr.patterns.find(p => p.id === pat.id);
    (pp.notes[chId] || (pp.notes[chId] = [])).push({ t, d, m: midi, v: vel });
  }, 'pattern');
}

// Ctrl+number: stamp a chord at the edit cursor.
function stampChord(chord) {
  const ch = store.channel();
  app.change(`Chord ${chord.label}`, pr => {
    const pp = pr.patterns.find(p => p.id === pr.currentPattern);
    const arr = pp.notes[ch.id] || (pp.notes[ch.id] = []);
    for (const m of chord.notes) arr.push({ t: cursorStep, d: Math.max(lastLen, 4), m, v: 0.75 });
  });
  cursorStep += Math.max(lastLen, 4);
}

// Split by instrument (FL calls it "split by channel"): every channel that has
// notes or steps in the pattern gets its own pattern, and each playlist clip of
// the original becomes a stack of clips, one per instrument track. Painting the
// final song becomes "turn this instrument on here", which beginners get instantly.
export function splitPattern(patId) {
  const src0 = store.project.patterns.find(p => p.id === patId);
  const used0 = store.project.channels.filter(c => (src0.notes[c.id] || []).length || (src0.steps[c.id] || []).some(Boolean));
  if (used0.length < 2) return false;
  app.change(`Split ${src0.name} by instrument`, pr => {
    const src = pr.patterns.find(p => p.id === patId);
    const used = pr.channels.filter(c => used0.some(u => u.id === c.id));
    const at = pr.patterns.indexOf(src) + 1;
    const made = used.map((c, i) => {
      const np = newPattern(`${src.name} · ${c.name}`, PATTERN_COLORS[(at + i) % PATTERN_COLORS.length], src.length);
      if (src.steps[c.id]) np.steps[c.id] = [...src.steps[c.id]];
      if (src.notes[c.id]) np.notes[c.id] = src.notes[c.id].map(n => ({ ...n }));
      return { np, c };
    });
    pr.patterns.splice(at, 0, ...made.map(m => m.np));

    const tracks = pr.arrangement.tracks;
    // reuse a track already named after the instrument, else the first track
    // with nothing else on it, else a new one
    const claimed = new Set();
    const free = t => !claimed.has(t.id) && !pr.arrangement.clips.some(cl => cl.track === t.id && cl.patternId !== src.id);
    const trackFor = name => {
      let t = tracks.find(x => x.name === name && !claimed.has(x.id)) || tracks.find(free);
      if (!t) { t = { id: Math.max(0, ...tracks.map(x => x.id)) + 1, name, mixer: 0, mute: false }; tracks.push(t); }
      t.name = name; claimed.add(t.id);
      return t;
    };
    const lanes = made.map(m => ({ ...m, track: trackFor(m.c.name).id }));
    const old = pr.arrangement.clips.filter(cl => cl.patternId === src.id);
    pr.arrangement.clips = pr.arrangement.clips.filter(cl => cl.patternId !== src.id);
    for (const cl of old) for (const l of lanes) {
      pr.arrangement.clips.push({ id: uid('cl'), type: 'pattern', patternId: l.np.id, track: l.track, start: cl.start, length: cl.length });
    }
    pr.currentPattern = made[0].np.id;
  });
  return true;
}
