// Sound bank browser (F8): the 200 original sounds plus Sigil presets.
import { store, newChannel } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';
import { SOUNDS, categories, createSoundInstrument } from '../audio/soundbank.js';

let root, cat = null, query = '';
let previewInst = null, previewId = null;

export function mount(container) {
  root = container;
  return { shown: render };
}

function preview(s) {
  const ctx = app.ctx;
  app.ensureAudio();
  if (previewId !== s.id) {
    if (previewInst) { try { previewInst.allNotesOff(); previewInst.dispose(); } catch { } }
    previewInst = createSoundInstrument(ctx, s.id);
    previewInst.output.connect(app.engine.masterIn);
    previewId = s.id;
  }
  const t = ctx.currentTime + 0.01;
  if (s.kind === 'drum') previewInst.playNote(60, 0.9, t, 0.4);
  else { const r = 57 + store.project.key.root % 12; [0, 3, 7].forEach((i, k) => previewInst.playNote(r + i, 0.7, t + k * 0.12, 0.8)); }
}

function addChannel(s) {
  app.change(`Add ${s.name}`, pr => {
    const used = new Set(pr.channels.map(c => c.mixer));
    let mix = 0; for (let i = 1; i <= 16; i++) if (!used.has(i)) { mix = i; break; }
    const c = newChannel(s.name, { type: 'sound', soundId: s.id }, mix);
    pr.channels.push(c); pr.selectedChannel = c.id;
  });
  app.toast(`${s.name} added to the rack`);
}

function replaceSelected(s) {
  const ch = store.channel();
  if (!ch) return;
  app.change(`Swap to ${s.name}`, pr => {
    const c = pr.channels.find(x => x.id === ch.id);
    c.source = { type: 'sound', soundId: s.id }; c.name = s.name;
  });
}

function render() {
  root.innerHTML = '';
  const cols = el('div', 'cols');
  const list = el('div', 'list');
  const cats = categories();
  if (!cat) cat = cats[0];
  for (const c of ['All', ...cats]) {
    const n = c === 'All' ? SOUNDS.length : SOUNDS.filter(s => s.category === c).length;
    const b = el('button', c === cat ? 'active' : '', `${c}  ·  ${n}`);
    b.onclick = () => { cat = c; render(); };
    list.appendChild(b);
  }
  const right = el('div');
  right.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden';
  const head = el('div', 'row');
  head.appendChild(el('h2', null, 'Sound Bank'));
  const q = el('input', 'tb-field');
  q.placeholder = 'search…'; q.style.width = '200px'; q.value = query;
  q.oninput = () => { query = q.value.toLowerCase(); fill(); };
  head.appendChild(q);
  head.appendChild(el('span', 'muted', 'Click to hear · double-click to add a channel · Shift+click swaps the selected channel'));
  const grid = el('div', 'grid');
  grid.style.flex = '1';
  right.append(head, grid);
  cols.append(list, right);
  root.appendChild(cols);

  function fill() {
    grid.innerHTML = '';
    const pool = SOUNDS.filter(s => (cat === 'All' || s.category === cat) && (!query || (s.name + ' ' + (s.tags || []).join(' ')).toLowerCase().includes(query)));
    for (const s of pool) {
      const card = el('button', 'card');
      card.append(el('div', null, s.name), el('small', null, `${s.category}${s.tags?.length ? ' · ' + s.tags.slice(0, 3).join(', ') : ''}`));
      card.onclick = e => { if (e.shiftKey) replaceSelected(s); else preview(s); };
      card.ondblclick = () => addChannel(s);
      grid.appendChild(card);
    }
  }
  fill();
}
