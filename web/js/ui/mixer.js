// Mixer (F9): master + 16 inserts, each with an effect chain.
import { store } from '../state.js';
import { app } from '../app.js';
import { el, knob, meter } from './widgets.js';
import { FX_LIST, PLUGINS } from '../plugins/index.js';
import { openPluginWindow } from './windows.js';

let root, stopMeter = null;

export function mount(container) {
  root = container;
  store.on(w => { if (w === 'all' && app.current === 'mixer') render(); });
  return { shown: render };
}

function fxChain(parent, list, path) {
  // path: { track } or { master: true }
  list.forEach((f, i) => {
    const m = PLUGINS[f.pluginId];
    const b = el('button', 'fx-slot' + (f.bypass ? ' bypass' : ''), m ? m.meta.name : f.pluginId);
    b.title = 'Click: open · Right-click: bypass · Shift+right-click: remove';
    b.onclick = () => openPluginWindow(app, path.master ? { master: i } : { track: path.track, slot: i }, `${m?.meta.name} · ${path.master ? 'Master' : 'Insert ' + path.track}`);
    b.oncontextmenu = e => {
      e.preventDefault();
      app.change(e.shiftKey ? 'Remove effect' : 'Bypass effect', pr => {
        const arr = path.master ? pr.mixer.master.fx : pr.mixer.tracks.find(t => t.id === path.track).fx;
        if (e.shiftKey) arr.splice(i, 1); else arr[i].bypass = !arr[i].bypass;
      });
    };
    parent.appendChild(b);
  });
  if (list.length < 8) {
    const s = el('select', 'fx-slot add');
    s.appendChild(el('option', null, '+ effect'));
    for (const f of FX_LIST) { const o = el('option', null, f.name); o.value = f.id; s.appendChild(o); }
    s.onchange = () => {
      if (!PLUGINS[s.value]) return;
      app.change(`Add ${PLUGINS[s.value].meta.name}`, pr => {
        const arr = path.master ? pr.mixer.master.fx : pr.mixer.tracks.find(t => t.id === path.track).fx;
        arr.push({ pluginId: s.value, state: null, bypass: false });
      });
    };
    parent.appendChild(s);
  }
}

function fader(parent, value, onInput) {
  const f = el('input');
  f.type = 'range'; f.min = 0; f.max = 1.25; f.step = 0.001; f.value = value;
  f.setAttribute('orient', 'vertical');
  f.oninput = () => onInput(+f.value, false);
  f.onchange = () => onInput(+f.value, true);
  parent.appendChild(f);
  const db = el('div', 'gk-value', toDb(value));
  parent.appendChild(db);
  f.addEventListener('input', () => (db.textContent = toDb(+f.value)));
  return f;
}
const toDb = v => (v <= 0.0001 ? '-∞' : (20 * Math.log10(v)).toFixed(1) + ' dB');

function render() {
  if (stopMeter) stopMeter();
  const p = store.project;
  root.innerHTML = '';
  const wrap = el('div', 'mixer');
  // master
  const ms = el('div', 'strip master');
  ms.appendChild(el('div', 'strip-name', 'MASTER'));
  fxChain(ms, p.mixer.master.fx, { master: true });
  stopMeter = meter(ms, app.engine.analyser, { width: 120, height: 10 });
  fader(ms, p.mixer.master.gain, (v, done) => {
    if (done) app.change('Master volume', pr => { pr.mixer.master.gain = v; });
    else app.engine.masterOut.gain.setTargetAtTime(v, app.ctx.currentTime, 0.01);
  });
  wrap.appendChild(ms);

  for (const t of p.mixer.tracks) {
    const s = el('div', 'strip');
    const name = el('input', 'strip-name');
    name.value = t.name;
    name.onchange = () => app.change('Rename insert', pr => { pr.mixer.tracks.find(x => x.id === t.id).name = name.value; });
    s.appendChild(name);
    const routed = p.channels.filter(c => c.mixer === t.id).map(c => c.name);
    const r = el('div', 'muted', routed.length ? routed.join(', ') : '—');
    r.style.cssText = 'font-size:10px;text-align:center;min-height:14px;overflow:hidden;width:100%;white-space:nowrap;text-overflow:ellipsis';
    s.appendChild(r);
    fxChain(s, t.fx, { track: t.id });
    const spacer = el('div'); spacer.style.flex = '1'; s.appendChild(spacer);
    knob(s, { label: 'Pan', min: -1, max: 1, value: t.pan, def: 0, size: 34, format: v => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)),
      onChange: v => { app.engine.mixer.get(t.id)?.pan.pan.setTargetAtTime(v, app.ctx.currentTime, 0.01); t.pan = v; } });
    fader(s, t.gain, (v, done) => {
      if (done) app.change('Insert volume', pr => { pr.mixer.tracks.find(x => x.id === t.id).gain = v; });
      else app.engine.mixer.get(t.id)?.gain.gain.setTargetAtTime(v, app.ctx.currentTime, 0.01);
    });
    const mute = el('button', 'gk-toggle' + (t.mute ? '' : ' on'), t.mute ? 'muted' : 'on');
    mute.onclick = () => app.change('Mute insert', pr => { const x = pr.mixer.tracks.find(y => y.id === t.id); x.mute = !x.mute; });
    s.appendChild(mute);
    wrap.appendChild(s);
  }
  root.appendChild(wrap);
}
