// Sound bank browser (F8): the 200 original sounds plus Sigil presets.
import { store, newChannel } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';
import { SOUNDS, categories, createSoundInstrument } from '../audio/soundbank.js';
import { all, saveSample, getSampleBuffer } from '../io/db.js';
import { uid } from '../state.js';

let root, cat = null, query = '';
let previewInst = null, previewId = null;

export function mount(container) {
  root = container;
  container.addEventListener('dragover', e => e.preventDefault());
  container.addEventListener('drop', async e => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio') || /\.(wav|mp3|ogg|flac|m4a|aiff?)$/i.test(f.name));
    if (files.length) { await importSamples(files); cat = 'My Samples'; render(); }
  });
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
  for (const c of ['My Samples', 'All', ...cats]) {
    const n = c === 'My Samples' ? '✦' : c === 'All' ? SOUNDS.length : SOUNDS.filter(s => s.category === c).length;
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

  async function fill() {
    grid.innerHTML = '';
    if (cat === 'My Samples') { await fillSamples(grid); return; }
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

// --- your own samples ---------------------------------------------------------------

export async function importSamples(files) {
  const added = [];
  for (const f of files) {
    const id = uid('smp');
    await saveSample(id, f.name.replace(/\.[^.]+$/, ''), f);
    added.push(id);
  }
  app.toast(`Added ${added.length} sample${added.length === 1 ? '' : 's'} to My Samples`);
  return added;
}

function pickFiles(cb) {
  const i = el('input'); i.type = 'file'; i.accept = 'audio/*'; i.multiple = true;
  i.onchange = () => cb([...i.files]);
  i.click();
}

async function previewSample(rec) {
  await app.ensureAudio();
  const buf = await getSampleBuffer(app.ctx, rec.id);
  if (!buf) return;
  const src = app.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(app.engine.masterIn);
  src.start(app.ctx.currentTime + 0.01, 0, Math.min(buf.duration, 6));
}

async function addSampleChannel(rec) {
  const buf = await getSampleBuffer(app.ctx, rec.id);
  if (!buf) return;
  app.engine.sampleBuffers.set(rec.id, buf);
  app.change(`Add ${rec.name}`, pr => {
    pr.samples[rec.id] = { name: rec.name, duration: buf.duration };
    const used = new Set(pr.channels.map(c => c.mixer));
    let mix = 0; for (let i = 1; i <= 16; i++) if (!used.has(i)) { mix = i; break; }
    const c = newChannel(rec.name, { type: 'plugin', pluginId: 'sampler', state: { sampleId: rec.id, name: rec.name, oneShot: buf.duration < 2.5 } }, mix);
    pr.channels.push(c); pr.selectedChannel = c.id;
  });
  app.toast(`${rec.name} is a channel now. Play it on the keyboard or paint steps.`);
}

async function fillSamples(grid) {
  const add = el('button', 'card', '+ Add your own samples…');
  add.appendChild(el('small', null, 'WAV, MP3, OGG, FLAC… or drop files anywhere on this page'));
  add.onclick = () => pickFiles(async f => { await importSamples(f); render(); });
  grid.appendChild(add);
  const recs = (await all('samples')).sort((a, b) => a.name.localeCompare(b.name));
  for (const r of recs) {
    const card = el('button', 'card');
    card.append(el('div', null, '∿ ' + r.name), el('small', null, `${Math.round(r.blob.size / 1024)} KB · double-click: add as channel`));
    card.onclick = () => previewSample(r);
    card.ondblclick = () => addSampleChannel(r);
    grid.appendChild(card);
  }
  if (!recs.length) grid.appendChild(el('p', 'muted', 'Nothing here yet. Your samples stay on this computer.'));
}
