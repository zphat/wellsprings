// Library & player (F3): every render and saved version of your tracks, plus
// playlists for streams and content. Lives in IndexedDB on this machine.
import { store } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';
import { all, put, del, get, saveVersion, loadVersion } from '../io/db.js';
import { renderSong } from '../audio/engine.js';
import { encodeWav, download } from '../io/wav.js';

let root, tab = 'tracks';
const audio = new Audio();
let queue = [], qi = -1, shuffle = false, nowPlaying = null, streamEl = null;

export function mount(container) {
  root = container;
  audio.addEventListener('ended', () => next());
  audio.addEventListener('timeupdate', updateBar);
  return { shown: render, renderCurrent, saveCurrentVersion };
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function saveCurrentVersion(note = '') {
  app.engine.collect(store.project);
  const v = await saveVersion(store.project, note);
  app.toast(`Saved "${store.project.name}" v${v}`);
  return v;
}

export async function renderCurrent({ downloadFile = true } = {}) {
  app.toast('Rendering… (offline, faster than real time)');
  app.engine.collect(store.project);
  const v = await saveVersion(store.project, 'render');
  const buf = await renderSong(store.project);
  const blob = encodeWav(buf, 24);
  const id = 'rn' + Date.now().toString(36);
  const name = `${store.project.name} v${v}`;
  await put('renders', { id, projectId: store.project.libraryId, projectName: store.project.name, v, name, blob, duration: buf.duration, created: Date.now(), bpm: store.project.bpm });
  if (downloadFile) download(blob, `${name}.wav`);
  app.toast(`Rendered ${name} (${fmt(buf.duration)}) into the Library`);
  if (app.current === 'library') render();
  return id;
}

async function play(list, i) {
  queue = list; qi = i;
  const r = queue[qi]; if (!r) return;
  if (audio.src) URL.revokeObjectURL(audio.src);
  audio.src = URL.createObjectURL(r.blob);
  nowPlaying = r;
  await audio.play();
  if (app.current === 'library') render();
  if (streamEl) streamEl.querySelector('.now').textContent = r.name;
}
function next() {
  if (!queue.length) return;
  const n = shuffle ? Math.floor(Math.random() * queue.length) : qi + 1;
  if (n < queue.length) play(queue, n); else { nowPlaying = null; if (app.current === 'library') render(); }
}

function updateBar() {
  const bar = root?.querySelector('.player .pos');
  if (bar) bar.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration || 0)}`;
  const rng = root?.querySelector('.player input');
  if (rng && audio.duration) rng.value = audio.currentTime / audio.duration;
}

function streamMode() {
  streamEl = el('div', 'stream-mode');
  streamEl.append(el('div', 'muted', 'NOW PLAYING · Wellsprings'), el('div', 'now', nowPlaying ? nowPlaying.name : '—'));
  const r = el('div', 'row');
  const b = (l, f) => { const x = el('button', 'cta alt', l); x.onclick = f; r.appendChild(x); };
  b('⏮', () => play(queue, Math.max(0, qi - 1)));
  b('⏯', () => (audio.paused ? audio.play() : audio.pause()));
  b('⏭', next);
  b('Exit (Esc)', () => { streamEl.remove(); streamEl = null; });
  streamEl.appendChild(r);
  streamEl.appendChild(el('div', 'muted', 'Capture this window in OBS for a stream overlay.'));
  document.body.appendChild(streamEl);
}
export function exitStreamMode() { if (streamEl) { streamEl.remove(); streamEl = null; return true; } return false; }

async function render() {
  const [renders, projects, playlists] = await Promise.all([all('renders'), all('projects'), all('playlists')]);
  renders.sort((a, b) => b.created - a.created);
  root.innerHTML = '';
  const head = el('div', 'row');
  head.appendChild(el('h2', null, 'Library'));
  for (const [k, l] of [['tracks', `Tracks (${renders.length})`], ['projects', `Projects (${projects.length})`], ['playlists', `Playlists (${playlists.length})`]]) {
    const b = el('button', 'tb-btn' + (tab === k ? ' on' : ''), l); b.onclick = () => { tab = k; render(); }; head.appendChild(b);
  }
  const rb = el('button', 'cta', 'Render current track → Library'); rb.onclick = () => renderCurrent({ downloadFile: false }); head.appendChild(rb);
  const sb = el('button', 'cta alt', 'Save version (Ctrl+S)'); sb.onclick = () => saveCurrentVersion().then(render); head.appendChild(sb);
  root.appendChild(head);

  if (tab === 'tracks') {
    // latest render per project is starred so you always grab the newest
    const latest = new Map();
    for (const r of renders) if (!latest.has(r.projectId)) latest.set(r.projectId, r.id);
    const t = el('table', 'lib');
    t.innerHTML = '<tr><th></th><th>Track</th><th>Length</th><th>BPM</th><th>Rendered</th><th></th></tr>';
    renders.forEach((r, i) => {
      const tr = el('tr', nowPlaying?.id === r.id ? 'playing' : '');
      const pb = el('button', 'tb-btn', '▶'); pb.onclick = () => play(renders, i);
      const td = x => { const d = el('td'); if (typeof x === 'string') d.textContent = x; else d.appendChild(x); tr.appendChild(d); };
      td(pb);
      td(r.name + (latest.get(r.projectId) === r.id ? '  ★ latest' : ''));
      td(fmt(r.duration)); td(String(r.bpm || '')); td(new Date(r.created).toLocaleString());
      const acts = el('div', 'row');
      const add = el('select', 'tb-field'); add.appendChild(el('option', null, '+ playlist'));
      for (const pl of playlists) { const o = el('option', null, pl.name); o.value = pl.id; add.appendChild(o); }
      add.onchange = async () => { const pl = await get('playlists', add.value); pl.items.push(r.id); await put('playlists', pl); app.toast(`Added to ${pl.name}`); render(); };
      const dl = el('button', 'tb-btn', '⤓'); dl.title = 'Download WAV'; dl.onclick = () => download(r.blob, r.name + '.wav');
      const rm = el('button', 'tb-btn', '✕'); rm.title = 'Remove from library'; rm.onclick = async () => { if (confirm(`Remove ${r.name} from the library?`)) { await del('renders', r.id); render(); } };
      acts.append(add, dl, rm); td(acts);
      t.appendChild(tr);
    });
    if (!renders.length) root.appendChild(el('p', 'muted', 'Nothing rendered yet. Hit "Render current track" or Ctrl+E.'));
    root.appendChild(t);
  }

  if (tab === 'projects') {
    projects.sort((a, b) => b.updated - a.updated);
    for (const pj of projects) {
      root.appendChild(el('h3', null, pj.name));
      const row = el('div', 'row');
      [...pj.versions].reverse().forEach((v, k) => {
        const b = el('button', 'tb-btn', `v${v.v}${k === 0 ? ' ★' : ''} · ${new Date(v.ts).toLocaleDateString()}${v.note ? ' · ' + v.note : ''}`);
        b.onclick = async () => {
          if (!confirm(`Open ${pj.name} v${v.v}? Unsaved changes to the current project are lost (save first with Ctrl+S).`)) return;
          const proj = await loadVersion(pj.id, v.v);
          if (proj) { await app.engine.loadSamples(proj); store.load(proj); app.show('pattern'); }
        };
        row.appendChild(b);
      });
      root.appendChild(row);
    }
    if (!projects.length) root.appendChild(el('p', 'muted', 'No saved projects yet. Ctrl+S saves a new version of the one you are on.'));
  }

  if (tab === 'playlists') {
    const nb = el('button', 'cta alt', '+ New playlist');
    nb.onclick = async () => { const n = prompt('Playlist name', 'Stream set'); if (n) { await put('playlists', { id: 'pl' + Date.now().toString(36), name: n, items: [] }); render(); } };
    root.appendChild(nb);
    for (const pl of playlists) {
      const items = pl.items.map(id => renders.find(r => r.id === id)).filter(Boolean);
      const h = el('div', 'row');
      h.appendChild(el('h3', null, `${pl.name} · ${items.length} tracks · ${fmt(items.reduce((s, r) => s + r.duration, 0))}`));
      const pa = el('button', 'tb-btn', '▶ Play all'); pa.onclick = () => play(items, 0);
      const sm = el('button', 'tb-btn', '📺 Stream mode'); sm.onclick = () => { play(items, 0); streamMode(); };
      const rm = el('button', 'tb-btn', '✕'); rm.onclick = async () => { if (confirm(`Delete playlist ${pl.name}?`)) { await del('playlists', pl.id); render(); } };
      h.append(pa, sm, rm);
      root.appendChild(h);
      items.forEach((r, i) => {
        const row = el('div', 'row');
        const up = el('button', 'tb-btn', '↑'); up.onclick = async () => { if (i) { [pl.items[i - 1], pl.items[i]] = [pl.items[i], pl.items[i - 1]]; await put('playlists', pl); render(); } };
        const x = el('button', 'tb-btn', '✕'); x.onclick = async () => { pl.items.splice(i, 1); await put('playlists', pl); render(); };
        row.append(up, x, el('span', null, `${i + 1}. ${r.name} (${fmt(r.duration)})`));
        root.appendChild(row);
      });
    }
  }

  // player
  const pl = el('div', 'player row');
  const b = (l, f, title) => { const x = el('button', 'tb-btn', l); x.onclick = f; if (title) x.title = title; pl.appendChild(x); };
  b('⏮', () => play(queue, Math.max(0, qi - 1)));
  b(audio.paused ? '▶' : '⏸', () => { audio.paused ? audio.play() : audio.pause(); render(); });
  b('⏭', next);
  b(shuffle ? '🔀 on' : '🔀', () => { shuffle = !shuffle; render(); }, 'Shuffle');
  b('📺', () => streamMode(), 'Stream mode: big now-playing screen for OBS');
  pl.appendChild(el('span', null, nowPlaying ? nowPlaying.name : 'Nothing playing'));
  const seek = el('input'); seek.type = 'range'; seek.min = 0; seek.max = 1; seek.step = 0.001; seek.style.flex = '1';
  seek.oninput = () => { if (audio.duration) audio.currentTime = +seek.value * audio.duration; };
  pl.appendChild(seek);
  pl.appendChild(el('span', 'pos muted', ''));
  root.appendChild(pl);
  updateBar();
}
