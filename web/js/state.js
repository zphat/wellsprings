// The project model, change events, and undo/redo.
// Time is counted in steps (16th notes). A bar is 16 steps.

export const STEPS_PER_BAR = 16;
let nextId = 1;
export const uid = p => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const PATTERN_COLORS = ['#9dff8a', '#ff8adf', '#8ad8ff', '#ffd78a', '#c08aff', '#ff9a8a', '#8affd2', '#e6ff8a'];

export function newChannel(name, source, mixer = 0) {
  return { id: uid('ch'), name, source, gain: 0.7, pan: 0, mute: false, solo: false, mixer };
}

export function newPattern(name, color, length = 16) {
  return { id: uid('pt'), name, color, length, steps: {}, notes: {} };
}

export function newProject() {
  const mixerTracks = [];
  for (let i = 0; i < 16; i++) mixerTracks.push({ id: i + 1, name: `Insert ${i + 1}`, gain: 0.8, pan: 0, mute: false, fx: [] });
  const channels = [
    newChannel('Kick', { type: 'sound', soundId: null, prefer: 'Kicks' }, 1),
    newChannel('Snare', { type: 'sound', soundId: null, prefer: 'Snares' }, 2),
    newChannel('Hat', { type: 'sound', soundId: null, prefer: 'Hats' }, 3),
    newChannel('808', { type: 'sound', soundId: null, prefer: '808s' }, 4),
    newChannel('Sigil', { type: 'plugin', pluginId: 'sigil', state: null }, 5),
  ];
  const p1 = newPattern('Pattern 1', PATTERN_COLORS[0]);
  return {
    format: 'wellsprings', version: 1,
    name: 'Untitled Incantation',
    bpm: 140, swing: 0, seed: 9990,
    key: { root: 9, scale: 'Minor' },
    channels,
    patterns: [p1],
    currentPattern: p1.id,
    selectedChannel: channels[4].id,
    arrangement: {
      tracks: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Track ${i + 1}`, mixer: 0, mute: false })),
      clips: [],
      loop: null,
    },
    mixer: { tracks: mixerTracks, master: { gain: 0.9, fx: [{ pluginId: 'seal', state: null, bypass: false }] } },
    samples: {}, // id -> { name, duration } ; audio data lives in js/io/db.js
  };
}

// --- store -----------------------------------------------------------------

const listeners = new Set();
const history = [], future = [];
let collectHook = null; // engine registers this to flush plugin states before snapshots

export const store = {
  project: newProject(),
  ui: { screen: 'pattern', mode: 'pattern', octave: 4, playing: false, recording: false, step: 0, songStep: 0 },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(what = 'all') { for (const fn of listeners) fn(what); },
  setCollectHook(fn) { collectHook = fn; },

  // Every user-visible change goes through here so it can be undone.
  mutate(label, fn, what = 'all') {
    if (collectHook) collectHook(this.project);
    history.push({ label, json: JSON.stringify(this.project) });
    if (history.length > 200) history.shift();
    future.length = 0;
    fn(this.project);
    this.emit(what);
    return label;
  },
  undo() {
    const h = history.pop();
    if (!h) return null;
    if (collectHook) collectHook(this.project);
    future.push({ label: h.label, json: JSON.stringify(this.project) });
    this.project = JSON.parse(h.json);
    this.emit('all');
    return h.label;
  },
  redo() {
    const f = future.pop();
    if (!f) return null;
    history.push({ label: f.label, json: JSON.stringify(this.project) });
    this.project = JSON.parse(f.json);
    this.emit('all');
    return f.label;
  },
  lastLabel: () => history.length ? history[history.length - 1].label : null,
  load(project) {
    history.length = 0; future.length = 0;
    this.project = project;
    this.emit('all');
  },

  // helpers
  pattern(id = this.project.currentPattern) { return this.project.patterns.find(p => p.id === id); },
  channel(id = this.project.selectedChannel) { return this.project.channels.find(c => c.id === id); },
};

// --- settings (per machine, not per project) --------------------------------

const SETTINGS_KEY = 'wellsprings.settings';
export const DEFAULT_SETTINGS = {
  warp: 0.65,            // piano roll bend, 0.35..1; it never goes straight
  crt: 0.7,              // scanlines + roll bar strength
  highlightKey: true,    // tint in-key rows in the piano roll
  snapToKey: false,      // keyboard + mouse input snaps to the key
  showNoteNames: true,
  chaos: 0.25,           // how often Murmur acts unprompted, 0..1
  murmurVoice: false,
  provider: 'anthropic', // Murmur's optional brain: anthropic | openai | xai
  apiKey: '',            // keys are stored only on this machine
  model: 'claude-opus-5-5',
  openaiKey: '',
  openaiModel: 'gpt-6-sol',
  xaiKey: '',
  xaiModel: 'grok-4.7',
  depth: null,           // onboarding answer: 'mystery' | 'mashup' | 'roll'
  reducedMotion: false,
};
export const settings = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { }
  const out = Object.assign({}, DEFAULT_SETTINGS, s);
  out.warp = Math.max(0.35, Math.min(1, +out.warp || DEFAULT_SETTINGS.warp));
  return out;
})();
export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { }
  store.emit('settings');
}
