// Boot: audio context, engine, screens, top bar, keyboard, Murmur.
import { store, settings, saveSettings } from './state.js';
import { app } from './app.js';
import { Engine } from './audio/engine.js';
import { NOTE_NAMES, SCALES } from './theory.js';
import { el } from './ui/widgets.js';
import * as pattern from './ui/pattern.js';
import * as playlist from './ui/playlist.js';
import * as mixer from './ui/mixer.js';
import * as browser from './ui/browser.js';
import * as library from './ui/library.js';
import { mountSettings, mountHelp, applyLook } from './ui/settings.js';
import { openOnboarding } from './ui/onboarding.js';
import { openPluginWindow, closeTopWindow } from './ui/windows.js';
import { bindKeyboard, midiMessage } from './keyboard.js';
import { connectMidiInput, exportMidi, importMidi } from './io/midi.js';
import { download } from './io/wav.js';
import * as murmur from './murmur/murmur.js';

app.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
app.engine = new Engine(app.ctx);
app.playStep = -1;
store.setCollectHook(p => app.engine.collect(p));

// keep the audio graph in step with the project
store.on(w => {
  if (w === 'all' || w === 'arrangement') {
    app.engine.sync(store.project);
    app.engine.setTempo(store.project.bpm);
    refreshTopbar();
  }
});
app.engine.sync(store.project);

// --- screens -------------------------------------------------------------------
const $ = id => document.getElementById(id);
app.screens.pattern = pattern.mount($('screen-pattern'));
app.screens.playlist = playlist.mount($('screen-playlist'));
app.screens.mixer = mixer.mount($('screen-mixer'));
app.screens.browser = browser.mount($('screen-browser'));
app.screens.library = library.mount($('screen-library'));
app.screens.settings = mountSettings($('screen-settings'), { openOnboarding, connectMidi, exportProject, importProject });
app.screens.help = mountHelp($('screen-help'));
app.murmur = murmur.mount($('murmur'));

const TABS = [['F6', 'pattern', 'Pattern'], ['F5', 'playlist', 'Playlist'], ['F9', 'mixer', 'Mixer'], ['F8', 'browser', 'Sound Bank'], ['F3', 'library', 'Library'], ['F10', 'settings', 'Settings'], ['F1', 'help', 'Codex']];
for (const [k, id, label] of TABS) {
  const b = el('button', 'tab');
  b.dataset.screen = id;
  b.innerHTML = `<kbd>${k}</kbd>${label}`;
  b.onclick = () => app.show(id);
  $('tabs').appendChild(b);
}

// --- transport -----------------------------------------------------------------
app.engine.onStep = s => {
  if (store.ui.mode === 'pattern') s = s % (store.pattern()?.length || 16);
  app.playStep = s;
  store.ui.step = s;
  app.screens.pattern.setPlayStep(s);
  if (store.ui.mode === 'song') app.screens.playlist.setPlayStep(s);
  const pos = $('tb-pos');
  if (pos) pos.textContent = `${Math.floor(s / 16) + 1}:${Math.floor((s % 16) / 4) + 1}:${(s % 4) + 1}`;
};

async function playPause() {
  await app.ensureAudio();
  if (store.ui.playing) {
    app.engine.stop();
    store.ui.playing = false;
    app.playStep = -1;
    app.screens.pattern.setPlayStep(-1);
    app.screens.playlist.setPlayStep(-1);
  } else {
    if (store.ui.mode === 'song') await app.engine.loadSamples(store.project);
    app.engine.start(store.ui.mode, store.ui.mode === 'song' ? app.screens.playlist.startStep : 0);
    store.ui.playing = true;
  }
  refreshTopbar();
}
function toggleMode() {
  const was = store.ui.playing;
  if (was) playPause();
  store.ui.mode = store.ui.mode === 'pattern' ? 'song' : 'pattern';
  refreshTopbar();
  if (was) playPause();
}
function toggleRecord() {
  store.ui.recording = !store.ui.recording;
  if (store.ui.recording) { store.ui.mode = 'pattern'; app.toast('Recording into the current pattern: play keys while it loops'); }
  refreshTopbar();
}

// --- top bar ----------------------------------------------------------------------
function buildTopbar() {
  const tb = $('topbar');
  tb.innerHTML = '';
  tb.appendChild(Object.assign(el('div', 'logo'), { innerHTML: 'WELL<b>SPRINGS</b>', title: 'Wellsprings · a grimoire for music · 9990' }));
  const grp = () => { const g = el('div', 'tb-group'); tb.appendChild(g); return g; };
  const btn = (g, id, label, title, fn, cls = '') => { const b = el('button', 'tb-btn ' + cls, label); b.id = id; b.title = title; b.onclick = fn; g.appendChild(b); return b; };

  const t = grp();
  btn(t, 'tb-play', '▶', 'Play / pause (Space)', playPause);
  btn(t, 'tb-stop', '■', 'Stop', () => { if (store.ui.playing) playPause(); });
  btn(t, 'tb-rec', '●', 'Record from keyboard / MIDI (Ctrl+R)', toggleRecord, 'rec');
  btn(t, 'tb-mode', 'PAT', 'Pattern / Song mode (Ctrl+L)', toggleMode);
  const pos = el('div', 'lcd', '1:1:1'); pos.id = 'tb-pos'; t.appendChild(pos);

  const s = grp();
  s.appendChild(el('span', 'tb-label', 'BPM'));
  const bpm = el('input', 'tb-field'); bpm.id = 'tb-bpm'; bpm.type = 'number'; bpm.min = 40; bpm.max = 240;
  bpm.onchange = () => app.change(`BPM ${bpm.value}`, p => { p.bpm = Math.max(40, Math.min(240, +bpm.value || 140)); });
  s.appendChild(bpm);
  s.appendChild(el('span', 'tb-label', 'Swing'));
  const sw = el('input'); sw.id = 'tb-swing'; sw.type = 'range'; sw.min = 0; sw.max = 0.8; sw.step = 0.01; sw.style.width = '70px';
  sw.onchange = () => app.change('Swing', p => { p.swing = +sw.value; });
  s.appendChild(sw);

  const k = grp();
  k.appendChild(el('span', 'tb-label', 'Key'));
  const root = el('select', 'tb-field'); root.id = 'tb-key';
  NOTE_NAMES.forEach((n, i) => { const o = el('option', null, n); o.value = i; root.appendChild(o); });
  root.onchange = () => app.change('Key', p => { p.key.root = +root.value; });
  const scale = el('select', 'tb-field'); scale.id = 'tb-scale';
  Object.keys(SCALES).forEach(n => { const o = el('option', null, n); o.value = n; scale.appendChild(o); });
  scale.onchange = () => app.change('Scale', p => { p.key.scale = scale.value; });
  k.append(root, scale);
  const oct = el('span', 'tb-label'); oct.id = 'tb-oct'; k.appendChild(oct);

  const e = grp();
  btn(e, 'tb-undo', '↶', 'Undo (Ctrl+Z)', undo);
  btn(e, 'tb-redo', '↷', 'Redo (Ctrl+Y)', redo);
  btn(e, 'tb-save', 'Save', 'Save a new version to the Library (Ctrl+S)', () => library.saveCurrentVersion());
  btn(e, 'tb-wav', 'WAV', 'Render the song to WAV and add it to the Library (Ctrl+E)', () => library.renderCurrent());
  btn(e, 'tb-mid', 'MIDI', 'Export the current pattern as a .mid file', exportPatternMidi);
  btn(e, 'tb-mm', '✶ Murmur', 'Show / hide Murmur (F2)', () => $('murmur').classList.toggle('closed'));

  const name = el('input', 'tb-field'); name.id = 'tb-name'; name.style.width = '180px'; name.title = 'Project name';
  name.onchange = () => app.change('Rename project', p => { p.name = name.value; });
  const ng = grp(); ng.appendChild(name);
}

function refreshTopbar() {
  const p = store.project;
  const set = (id, prop, v) => { const n = $(id); if (n && document.activeElement !== n) n[prop] = v; };
  set('tb-bpm', 'value', p.bpm);
  set('tb-swing', 'value', p.swing);
  set('tb-key', 'value', p.key.root);
  set('tb-scale', 'value', p.key.scale);
  set('tb-name', 'value', p.name);
  $('tb-play')?.classList.toggle('on', store.ui.playing);
  $('tb-rec')?.classList.toggle('on', store.ui.recording);
  const m = $('tb-mode'); if (m) { m.textContent = store.ui.mode === 'song' ? 'SONG' : 'PAT'; m.classList.toggle('on', store.ui.mode === 'song'); }
  const o = $('tb-oct'); if (o) o.textContent = `oct ${store.ui.octave}`;
  if ($('tb-play')) $('tb-play').textContent = store.ui.playing ? '❚❚' : '▶';
}
store.on(w => { if (w === 'octave' || w === 'settings') refreshTopbar(); if (w === 'settings') applyLook(); });

function undo() { const l = store.undo(); app.toast(l ? `Undid: ${l}` : 'Nothing to undo'); }
function redo() { const l = store.redo(); app.toast(l ? `Redid: ${l}` : 'Nothing to redo'); }

// --- files ------------------------------------------------------------------------------
function exportPatternMidi() {
  const pat = store.pattern();
  const tracks = store.project.channels.map(c => ({
    name: c.name,
    notes: [...(pat.notes[c.id] || []), ...(pat.steps[c.id] || []).map((on, t) => (on ? { t, d: 1, m: c.source.pitch || 60, v: typeof on === 'number' ? on : 0.8 } : null)).filter(Boolean)],
  })).filter(t => t.notes.length);
  download(exportMidi(tracks, store.project.bpm), `${store.project.name} - ${pat.name}.mid`);
}
function exportProject() {
  app.engine.collect(store.project);
  download(new Blob([JSON.stringify(store.project, null, 1)], { type: 'application/json' }), `${store.project.name}.wellspring`);
  app.toast('Exported the project file (imported audio stays in this browser library)');
}
function importProject() {
  const i = el('input'); i.type = 'file'; i.accept = '.wellspring,.json,.mid,.midi';
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    if (/\.midi?$/i.test(f.name)) {
      const tracks = importMidi(await f.arrayBuffer());
      app.change(`Import ${f.name}`, p => {
        const pat = p.patterns.find(x => x.id === p.currentPattern);
        tracks.forEach((t, k) => {
          const ch = p.channels.filter(c => c.source.type === 'plugin')[k] || p.channels.find(c => c.id === p.selectedChannel);
          pat.notes[ch.id] = t.notes;
          pat.length = Math.max(pat.length, Math.ceil(Math.max(...t.notes.map(n => n.t + n.d)) / 16) * 16);
        });
      });
      app.toast(`Imported ${tracks.length} MIDI track(s) into the current pattern`);
    } else {
      const proj = JSON.parse(await f.text());
      if (proj.format !== 'wellsprings') { app.toast('That file is not a Wellsprings project'); return; }
      await app.engine.loadSamples(proj);
      store.load(proj);
    }
  };
  i.click();
}
async function connectMidi() {
  const n = await connectMidiInput(midiMessage);
  app.toast(n === false ? 'Web MIDI is not available in this browser (try Chrome or Edge)' : `MIDI connected: ${n} input(s). Notes go to the selected channel.`);
}

// --- keyboard ------------------------------------------------------------------------------
bindKeyboard({
  playPause, toggleMode, toggleRecord, undo, redo,
  save: () => library.saveCurrentVersion(),
  render: () => library.renderCurrent(),
  selectAll: () => pattern.selectAll(),
  deleteSel: () => pattern.deleteSelection(),
  transpose: d => app.current === 'pattern' && pattern.transposeSelection(d),
  stampChord: c => { app.show('pattern'); app.screens.pattern.stampChord(c); },
  escape: () => { if (library.exitStreamMode()) return; if (!closeTopWindow()) document.activeElement?.blur(); },
  window: w => {
    if (w === 'murmur') { app.murmur.focus(); return; }
    if (w === 'instrument') { const c = store.channel(); if (c) openPluginWindow(app, { channel: c.id }, c.name); return; }
    if (w === 'roll') { app.show('pattern'); document.querySelector('.roll-wrap')?.scrollIntoView({ behavior: 'smooth' }); return; }
    app.show(w);
  },
});

// unlock audio on the first gesture (browsers start AudioContexts suspended)
addEventListener('pointerdown', () => app.ensureAudio(), { once: true });
addEventListener('keydown', () => app.ensureAudio(), { once: true });

// Murmur's unprompted chaos runs while music plays
setInterval(() => { if (store.ui.playing) app.murmur.chaosTick(); }, 5000);

// a little CRT glitch now and then on the pattern screen
setInterval(() => {
  if (settings.reducedMotion || settings.warp <= 0 || app.current !== 'pattern' || Math.random() > 0.15) return;
  document.body.classList.add('flicker');
  setTimeout(() => document.body.classList.remove('flicker'), 130);
}, 9990);

if (innerWidth < 760) $('murmur').classList.add('closed');
buildTopbar();
applyLook();
refreshTopbar();
app.show('pattern');
if (!settings.depth || !sessionStorage.getItem('ws.asked')) { try { sessionStorage.setItem('ws.asked', '1'); } catch { } openOnboarding(); }
window.wellsprings = { app, store, settings }; // handy in the devtools console
