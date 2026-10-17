// Computer keyboard as an instrument + all shortcuts. Uses physical key codes
// so it works the same on any keyboard layout.
import { store } from './state.js';
import { app } from './app.js';
import { numberRowChords, spiceChords, snapToKey } from './theory.js';
import { settings } from './state.js';

// Offsets from C of the current octave. Black keys sit above the gaps, like a piano.
export const KEYMAP = {
  KeyA: 0, KeyS: 2, KeyD: 4, KeyF: 5, KeyG: 7, KeyH: 9, KeyJ: 11, KeyK: 12, KeyL: 14, Semicolon: 16, Quote: 17,
  KeyQ: -2, KeyW: 1, KeyE: 3, KeyT: 6, KeyY: 8, KeyU: 10, KeyO: 13, KeyP: 15, BracketRight: 18,
  KeyZ: -12, KeyX: -10, KeyC: -8, KeyV: -7, KeyB: -5, KeyN: -3, KeyM: -1, Comma: 0, Period: 2, Slash: 4,
};

const held = new Map(); // code -> { midis, chId, start }

const base = () => 12 * (store.ui.octave + 1);
const typing = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;

function noteDown(code, midis) {
  const chId = store.project.selectedChannel;
  if (!chId || held.has(code)) return;
  for (const m of midis) app.engine.noteOn(chId, m, 0.85);
  held.set(code, { midis, chId, start: app.playStep });
  app.keysChanged && app.keysChanged(midis, true);
}
function noteUp(code) {
  const h = held.get(code);
  if (!h) return;
  held.delete(code);
  for (const m of h.midis) app.engine.noteOff(h.chId, m);
  app.keysChanged && app.keysChanged(h.midis, false);
  if (store.ui.recording && store.ui.playing && store.ui.mode === 'pattern' && h.start >= 0) {
    let end = app.playStep;
    if (end < h.start) end += store.pattern().length;
    for (const m of h.midis) app.screens.pattern.recordNote(h.chId, m, h.start, Math.max(h.start + 1, end));
  }
}

export function midiMessage([st, a, b]) {
  const type = st & 0xf0;
  const code = 'midi' + a;
  if (type === 0x90 && b > 0) {
    const chId = store.project.selectedChannel;
    app.engine.noteOn(chId, a, b / 127);
    held.set(code, { midis: [a], chId, start: app.playStep });
  } else if (type === 0x80 || (type === 0x90 && b === 0)) noteUp(code);
}

export function bindKeyboard(actions) {
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { actions.escape(); return; }
    if (typing(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;

    // F-keys: windows
    const fmap = { F1: 'help', F2: 'murmur', F3: 'library', F4: 'instrument', F5: 'playlist', F6: 'pattern', F7: 'roll', F8: 'browser', F9: 'mixer', F10: 'settings' };
    if (fmap[e.code]) { e.preventDefault(); actions.window(fmap[e.code]); return; }

    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); actions.undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); actions.redo(); return; }
      if (k === 's') { e.preventDefault(); actions.save(); return; }
      if (k === 'e') { e.preventDefault(); actions.render(); return; }
      if (k === 'l') { e.preventDefault(); actions.toggleMode(); return; }
      if (k === 'r') { e.preventDefault(); actions.toggleRecord(); return; }
      if (k === 'a' && app.current === 'pattern') { e.preventDefault(); actions.selectAll(); return; }
      if (/^Digit\d$/.test(e.code)) { e.preventDefault(); const i = (+e.code.slice(5) + 9) % 10; actions.stampChord(numberRowChords(store.project.key)[i]); return; }
      return;
    }

    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) actions.playPause(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { if (actions.deleteSel()) e.preventDefault(); return; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const d = e.code === 'ArrowUp' ? 1 : -1;
      if (e.shiftKey && actions.transpose(d)) return;
      store.ui.octave = Math.max(0, Math.min(8, store.ui.octave + d));
      store.emit('octave');
      app.toast(`Octave ${store.ui.octave} (A = C${store.ui.octave})`);
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const chs = store.project.channels;
      const i = chs.findIndex(c => c.id === store.project.selectedChannel);
      const n = chs[(i + (e.code === 'ArrowRight' ? 1 : -1) + chs.length) % chs.length];
      if (n) { store.project.selectedChannel = n.id; store.emit('pattern'); app.toast(`Channel: ${n.name}`); }
      return;
    }
    if (e.code === 'Minus' || e.code === 'Equal') {
      const ps = store.project.patterns;
      const i = ps.findIndex(p => p.id === store.project.currentPattern);
      store.project.currentPattern = ps[(i + (e.code === 'Equal' ? 1 : -1) + ps.length) % ps.length].id;
      store.emit('pattern');
      return;
    }
    if (e.repeat) { if (KEYMAP[e.code] != null || /^Digit/.test(e.code)) e.preventDefault(); return; }

    if (/^Digit\d$/.test(e.code)) {
      const i = (+e.code.slice(5) + 9) % 10; // 1..9,0 -> 0..9
      const chord = (e.shiftKey ? spiceChords : numberRowChords)(store.project.key)[i];
      const shift = (store.ui.octave - 4) * 12;
      noteDown(e.code, chord.notes.map(m => m + shift));
      app.toast(`${e.shiftKey ? 'Spice' : 'Chord'} ${i + 1}: ${chord.label}`);
      return;
    }
    if (KEYMAP[e.code] != null) {
      e.preventDefault();
      let m = base() + KEYMAP[e.code];
      if (settings.snapToKey) m = snapToKey(m, store.project.key);
      noteDown(e.code, [m]);
    }
  });
  addEventListener('keyup', e => { if (held.has(e.code)) noteUp(e.code); });
  addEventListener('blur', () => { for (const code of [...held.keys()]) noteUp(code); });
}
