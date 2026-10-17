// Playlist / arrangement (F5). Straight, calm, FL-style: pick a pattern or a
// sample on the left, paint it onto tracks. No warping on this screen.
import { store, STEPS_PER_BAR, uid } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';
import { saveSample } from '../io/db.js';

const HEAD_W = 120, RULER_H = 24, TRACK_H = 42;
let root, side, main, canvas, g, barW = 64, brush = null, playStep = -1, drag = null, startStep = 0;

export function mount(container) {
  root = container;
  root.innerHTML = '';
  const wrap = el('div', 'pl-wrap');
  side = el('div', 'pl-side');
  main = el('div', 'pl-main');
  canvas = el('canvas');
  main.appendChild(canvas);
  wrap.append(side, main);
  root.appendChild(wrap);
  g = canvas.getContext('2d');
  bind();
  store.on(w => { if (w !== 'none') { renderSide(); draw(); } });
  new ResizeObserver(() => draw()).observe(main);
  renderSide();
  return { shown() { renderSide(); draw(); }, setPlayStep(s) { playStep = s; if (app.current === 'playlist') draw(); }, get startStep() { return startStep; }, importFiles };
}

const stepW = () => barW / STEPS_PER_BAR;

function renderSide() {
  const p = store.project;
  side.innerHTML = '';
  side.appendChild(el('h4', null, 'Patterns'));
  if (!brush && p.patterns[0]) brush = { type: 'pattern', id: p.patterns[0].id };
  for (const pt of p.patterns) {
    const b = el('button', 'pl-item' + (brush?.type === 'pattern' && brush.id === pt.id ? ' active' : ''), pt.name);
    b.style.setProperty('--c', pt.color);
    b.onclick = () => { brush = { type: 'pattern', id: pt.id }; renderSide(); };
    b.ondblclick = () => { store.project.currentPattern = pt.id; store.emit('pattern'); app.show('pattern'); };
    b.title = 'Click: paint with this pattern · Double-click: edit it';
    side.appendChild(b);
  }
  side.appendChild(el('h4', null, 'Audio'));
  for (const [id, s] of Object.entries(p.samples)) {
    const b = el('button', 'pl-item' + (brush?.type === 'audio' && brush.id === id ? ' active' : ''), '∿ ' + s.name);
    b.style.setProperty('--c', 'var(--cyan)');
    b.onclick = () => { brush = { type: 'audio', id }; renderSide(); };
    side.appendChild(b);
  }
  const imp = el('button', 'pl-item', '+ Import audio…');
  imp.onclick = () => {
    const i = el('input'); i.type = 'file'; i.accept = 'audio/*'; i.multiple = true;
    i.onchange = () => importFiles([...i.files]);
    i.click();
  };
  side.appendChild(imp);
  side.appendChild(el('h4', null, 'Tips'));
  const tip = el('div', 'muted');
  tip.style.fontSize = '11px';
  tip.innerHTML = 'Click a track to paint · drag to move · drag the right edge to resize · right-click deletes · click the ruler to set the start · shift-drag the ruler for a loop · drop audio files anywhere · Alt = no snap · Ctrl+wheel zoom';
  side.appendChild(tip);
}

async function importFiles(files) {
  for (const f of files) {
    const id = uid('smp');
    await saveSample(id, f.name, f);
    let duration = 0;
    try {
      const buf = await app.ctx.decodeAudioData(await f.arrayBuffer());
      app.engine.sampleBuffers.set(id, buf);
      duration = buf.duration;
      waveCache.delete(id);
    } catch { app.toast(`Couldn't decode ${f.name}`); continue; }
    app.change(`Import ${f.name}`, pr => { pr.samples[id] = { name: f.name.replace(/\.[^.]+$/, ''), duration }; });
    brush = { type: 'audio', id };
  }
}

// --- geometry -------------------------------------------------------------------------

function layout() {
  const p = store.project;
  const steps = Math.max(app.engine.songLength() + STEPS_PER_BAR * 8, STEPS_PER_BAR * 32);
  const W = Math.max(main.clientWidth, HEAD_W + (steps / STEPS_PER_BAR) * barW);
  const H = Math.max(main.clientHeight - 2, RULER_H + p.arrangement.tracks.length * TRACK_H);
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W, H };
}

const waveCache = new Map();
function waveform(id, w) {
  const buf = app.engine.sampleBuffers.get(id);
  if (!buf) return null;
  const k = id;
  if (!waveCache.has(k)) {
    const d = buf.getChannelData(0), n = 2000, out = new Float32Array(n), block = Math.floor(d.length / n) || 1;
    for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j < block; j++) m = Math.max(m, Math.abs(d[i * block + j] || 0)); out[i] = m; }
    waveCache.set(k, { peaks: out, dur: buf.duration });
  }
  return waveCache.get(k);
}

function draw() {
  if (!canvas || app.current !== 'playlist') return;
  const p = store.project, { W, H } = layout(), sw = stepW();
  g.fillStyle = '#0b0d13'; g.fillRect(0, 0, W, H);
  // tracks
  p.arrangement.tracks.forEach((t, i) => {
    const y = RULER_H + i * TRACK_H;
    g.fillStyle = i % 2 ? '#0d1017' : '#0f121a'; g.fillRect(HEAD_W, y, W, TRACK_H);
    g.fillStyle = '#141722'; g.fillRect(0, y, HEAD_W, TRACK_H - 1);
    g.fillStyle = t.mute ? '#4a4f5a' : '#9dff8a'; g.beginPath(); g.arc(12, y + TRACK_H / 2, 5, 0, 7); g.fill();
    g.fillStyle = t.mute ? '#555' : '#d9e4d2'; g.font = '12px IBM Plex Mono, monospace'; g.fillText(t.name.slice(0, 12), 24, y + TRACK_H / 2 + 4);
  });
  // bar lines
  for (let b = 0; HEAD_W + b * barW < W; b++) {
    const x = HEAD_W + b * barW;
    g.fillStyle = b % 4 === 0 ? 'rgba(255,215,138,.18)' : 'rgba(255,255,255,.05)';
    g.fillRect(x, RULER_H, 1, H);
    if (b % (barW < 30 ? 4 : 1) === 0) { g.fillStyle = '#7d8794'; g.font = '11px IBM Plex Mono, monospace'; g.fillText(b + 1, x + 3, 16); }
  }
  // ruler + loop
  g.fillStyle = '#141722'; g.fillRect(HEAD_W, 0, W, RULER_H - 1);
  for (let b = 0; HEAD_W + b * barW < W; b += barW < 30 ? 4 : 1) { g.fillStyle = '#7d8794'; g.fillText(b + 1, HEAD_W + b * barW + 3, 16); }
  const loop = p.arrangement.loop;
  if (loop) { g.fillStyle = 'rgba(255,138,223,.25)'; g.fillRect(HEAD_W + loop.start * sw, 0, (loop.end - loop.start) * sw, RULER_H - 1); }
  g.fillStyle = '#ffd78a'; g.beginPath(); const sx = HEAD_W + startStep * sw; g.moveTo(sx, RULER_H - 1); g.lineTo(sx - 6, 8); g.lineTo(sx + 6, 8); g.fill();
  // clips
  for (const c of p.arrangement.clips) {
    const ti = p.arrangement.tracks.findIndex(t => t.id === c.track);
    if (ti < 0) continue;
    const x = HEAD_W + c.start * sw, y = RULER_H + ti * TRACK_H + 2, w = c.length * sw, h = TRACK_H - 4;
    if (c.type === 'pattern') {
      const pt = p.patterns.find(q => q.id === c.patternId);
      const col = pt?.color || '#9dff8a';
      g.fillStyle = col + '33'; g.fillRect(x, y, w, h);
      g.strokeStyle = col; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // mini notes preview
      if (pt) {
        const all = Object.values(pt.notes).flat();
        if (all.length) {
          const lo = Math.min(...all.map(n => n.m)), hi = Math.max(...all.map(n => n.m)) + 1;
          g.fillStyle = col;
          for (let rep = 0; rep * pt.length < c.length; rep++) for (const n of all) {
            const nx = x + (rep * pt.length + n.t) * sw; if (nx > x + w) break;
            g.fillRect(nx, y + 14 + (hi - n.m) / (hi - lo || 1) * (h - 18), Math.max(1, n.d * sw), 2);
          }
        }
        for (const [cid, arr] of Object.entries(pt.steps)) arr.forEach((on, s) => {
          if (!on) return;
          for (let rep = 0; rep * pt.length < c.length; rep++) { const nx = x + (rep * pt.length + s) * sw; if (nx < x + w) g.fillRect(nx, y + h - 4, Math.max(1, sw * 0.6), 2); }
        });
      }
      g.fillStyle = '#e8ffe2'; g.font = '11px IBM Plex Mono, monospace'; g.fillText(pt ? pt.name : '?', x + 4, y + 12);
    } else {
      g.fillStyle = 'rgba(138,216,255,.18)'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#8ad8ff'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const wf = waveform(c.sampleId);
      if (wf) {
        g.fillStyle = '#8ad8ff';
        const secPerPx = (60 / p.bpm / 4) / sw;
        for (let px = 0; px < w; px++) {
          const sec = (c.offset || 0) + px * secPerPx;
          if (sec > wf.dur) break;
          const pk = wf.peaks[Math.floor(sec / wf.dur * wf.peaks.length)] || 0;
          g.fillRect(x + px, y + h / 2 - pk * h / 2, 1, Math.max(1, pk * h));
        }
      }
      g.fillStyle = '#e2f6ff'; g.fillText(p.samples[c.sampleId]?.name || 'audio', x + 4, y + 12);
    }
  }
  if (playStep >= 0) { g.fillStyle = '#9dff8a'; g.fillRect(HEAD_W + playStep * sw, 0, 2, H); }
}

// --- interaction -------------------------------------------------------------------------

function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function clipAt(x, y) {
  const p = store.project, sw = stepW();
  const ti = Math.floor((y - RULER_H) / TRACK_H), track = p.arrangement.tracks[ti];
  if (!track) return null;
  const step = (x - HEAD_W) / sw;
  const clips = p.arrangement.clips;
  for (let i = clips.length - 1; i >= 0; i--) {
    const c = clips[i];
    if (c.track === track.id && step >= c.start && step < c.start + c.length) return { c, edge: (c.start + c.length - step) * sw < 8 };
  }
  return null;
}

function bind() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    const { x, y } = pos(e), p = store.project, sw = stepW();
    const snap = e.altKey ? 1 : STEPS_PER_BAR;
    const step = Math.max(0, (x - HEAD_W) / sw);
    if (y < RULER_H && x > HEAD_W) {
      if (e.shiftKey) {
        const s0 = Math.floor(step / snap) * snap;
        store.mutate('Loop', pr => { pr.arrangement.loop = { start: s0, end: s0 + snap }; });
        drag = { kind: 'loop', s0 };
      } else { startStep = Math.floor(step / snap) * snap; if (e.detail === 2) store.mutate('Clear loop', pr => { pr.arrangement.loop = null; }); draw(); }
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const ti = Math.floor((y - RULER_H) / TRACK_H), track = p.arrangement.tracks[ti];
    if (!track) return;
    if (x < HEAD_W) {
      if (x < 22) app.change('Mute track', pr => { const t = pr.arrangement.tracks[ti]; t.mute = !t.mute; });
      else if (e.detail === 2) { const n = prompt('Track name', track.name); if (n) app.change('Rename track', pr => { pr.arrangement.tracks[ti].name = n; }); }
      return;
    }
    const hit = clipAt(x, y);
    if (e.button === 2) { if (hit) app.change('Delete clip', pr => { pr.arrangement.clips = pr.arrangement.clips.filter(c => c.id !== hit.c.id); }); return; }
    canvas.setPointerCapture(e.pointerId);
    if (hit) {
      store.mutate(hit.edge ? 'Resize clip' : 'Move clip', () => { }, 'none');
      const c = store.project.arrangement.clips.find(q => q.id === hit.c.id);
      drag = { kind: hit.edge ? 'resize' : 'move', c, sx: x, sy: y, start: c.start, length: c.length, track: c.track, snap };
      if (c.type === 'pattern') brush = { type: 'pattern', id: c.patternId };
      return;
    }
    if (!brush) return;
    const start = Math.floor(step / snap) * snap;
    let length = STEPS_PER_BAR;
    if (brush.type === 'pattern') length = p.patterns.find(q => q.id === brush.id)?.length || 16;
    else { const s = p.samples[brush.id]; length = Math.max(1, Math.ceil((s?.duration || 1) / (60 / p.bpm / 4))); }
    const id = uid('cl');
    app.change('Place clip', pr => {
      pr.arrangement.clips.push(brush.type === 'pattern'
        ? { id, type: 'pattern', patternId: brush.id, track: track.id, start, length }
        : { id, type: 'audio', sampleId: brush.id, track: track.id, start, length, offset: 0, gain: 1 });
    });
    const c = store.project.arrangement.clips.find(q => q.id === id);
    drag = { kind: 'move', c, sx: x, sy: y, start: c.start, length: c.length, track: c.track, snap, fresh: true };
  });
  canvas.addEventListener('pointermove', e => {
    const { x, y } = pos(e), sw = stepW();
    if (!drag) {
      const h = x > HEAD_W && y > RULER_H ? clipAt(x, y) : null;
      canvas.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'default';
      return;
    }
    const p = store.project;
    if (drag.kind === 'loop') {
      const s = Math.max(drag.s0 + 1, Math.ceil(((x - HEAD_W) / sw) / (e.altKey ? 1 : STEPS_PER_BAR)) * (e.altKey ? 1 : STEPS_PER_BAR));
      p.arrangement.loop = { start: drag.s0, end: s };
    } else if (drag.kind === 'move') {
      const ds = Math.round((x - drag.sx) / sw / drag.snap) * drag.snap;
      drag.c.start = Math.max(0, drag.start + ds);
      const ti = Math.max(0, Math.min(p.arrangement.tracks.length - 1, Math.floor((y - RULER_H) / TRACK_H)));
      drag.c.track = p.arrangement.tracks[ti].id;
    } else {
      const ds = Math.round((x - drag.sx) / sw / (e.altKey ? 1 : 4)) * (e.altKey ? 1 : 4);
      drag.c.length = Math.max(1, drag.length + ds);
    }
    draw();
  });
  const up = () => { if (drag) { drag = null; store.emit('arrangement'); draw(); } };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  main.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    barW = Math.max(12, Math.min(240, barW * (e.deltaY < 0 ? 1.15 : 0.87)));
    draw();
  }, { passive: false });
  main.addEventListener('dragover', e => e.preventDefault());
  main.addEventListener('drop', e => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio') || /\.(wav|mp3|ogg|flac|m4a|aiff?)$/i.test(f.name));
    if (files.length) importFiles(files);
  });
}
