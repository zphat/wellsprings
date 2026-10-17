// Settings (F10) and the help page (F1).
import { store, settings, saveSettings } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';

export function mountSettings(root, { openOnboarding, connectMidi, exportProject, importProject }) {
  function render() {
    root.innerHTML = '';
    root.appendChild(el('h2', null, 'Settings'));
    const f = el('div', 'form');
    const row = (label, input, hint) => {
      const l = el('label'); l.appendChild(el('span', null, label)); l.appendChild(input);
      f.appendChild(l);
      if (hint) { const h = el('div', 'muted', hint); h.style.cssText = 'font-size:11px;margin:-6px 0 4px 230px'; f.appendChild(h); }
    };
    const slider = (key, min, max, step, after) => {
      const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = settings[key];
      i.oninput = () => { settings[key] = +i.value; saveSettings(); after && after(); };
      return i;
    };
    const check = key => {
      const i = el('input'); i.type = 'checkbox'; i.checked = !!settings[key];
      i.onchange = () => { settings[key] = i.checked; saveSettings(); applyLook(); };
      return i;
    };
    f.appendChild(el('h3', null, 'Look'));
    row('Piano roll warp', slider('warp', 0, 1, 0.05), '0 keeps the roll dead straight. The playlist and mixer never warp.');
    row('CRT scanlines', slider('crt', 0, 1, 0.05, applyLook));
    row('Reduce motion', check('reducedMotion'), 'Stops the rolling bar, swaying rack and warp animation.');
    f.appendChild(el('h3', null, 'Helping hands'));
    row('Highlight the key', check('highlightKey'), 'In-key rows glow green, the root glows gold, everything else goes dark.');
    row('Snap notes to key', check('snapToKey'), 'Mouse and computer keyboard can only land on in-key notes.');
    row('Note names on notes', check('showNoteNames'));
    f.appendChild(el('h3', null, 'Murmur'));
    row('Chaos level', slider('chaos', 0, 1, 0.05), '0 = only acts when asked. 1 = Murmur runs the studio. Everything Murmur does can be undone (Ctrl+Z).');
    row('Murmur speaks out loud', check('murmurVoice'));
    const key = el('input'); key.type = 'password'; key.value = settings.apiKey; key.placeholder = 'optional: sk-ant-…';
    key.onchange = () => { settings.apiKey = key.value.trim(); saveSettings(); };
    row('Anthropic API key', key, 'Optional. Without it Murmur runs on his built-in tricks. With it he understands free-form requests. Stored only in this browser; sent only to api.anthropic.com.');
    const model = el('select');
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) { const o = el('option', null, m); o.value = m; model.appendChild(o); }
    model.value = settings.model;
    model.onchange = () => { settings.model = model.value; saveSettings(); };
    row('Murmur model', model, 'Haiku is fastest and cheapest, Opus is smartest.');
    f.appendChild(el('h3', null, 'Project & hardware'));
    const btns = el('div', 'row');
    const b = (l, fn) => { const x = el('button', 'tb-btn', l); x.onclick = fn; btns.appendChild(x); };
    b('Start-up question again', openOnboarding);
    b('Connect MIDI keyboard', connectMidi);
    b('Export project file', exportProject);
    b('Import project / MIDI file', importProject);
    f.appendChild(btns);
    root.appendChild(f);
  }
  return { shown: render };
}

export function applyLook() {
  document.documentElement.style.setProperty('--crt', settings.crt);
  document.body.classList.toggle('reduced', settings.reducedMotion);
}

export function mountHelp(root) {
  root.innerHTML = `
  <h2>The Wellsprings Codex</h2>
  <p class="muted">Everything is where FL Studio users expect it. The pattern screen bends a little on purpose; switch the warp off in Settings if you need it straight.</p>
  <div class="help-grid">
    <div><h3>Windows (F-keys)</h3>
      <kbd>F1</kbd> this codex<br><kbd>F2</kbd> Murmur<br><kbd>F3</kbd> library &amp; player<br><kbd>F4</kbd> open selected instrument<br>
      <kbd>F5</kbd> playlist / arrangement<br><kbd>F6</kbd> pattern (rack + piano roll)<br><kbd>F7</kbd> piano roll focus<br>
      <kbd>F8</kbd> sound bank<br><kbd>F9</kbd> mixer<br><kbd>F10</kbd> settings<br><kbd>Esc</kbd> close top window</div>
    <div><h3>Play the computer keyboard</h3>
      White keys: <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd><kbd>'</kbd> (C to F)<br>
      Black keys: <kbd>W</kbd><kbd>E</kbd> · <kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd> · <kbd>O</kbd><kbd>P</kbd> · <kbd>]</kbd> sit above the gaps like a real piano (<kbd>Q</kbd> is the B♭ just below)<br>
      Bottom row <kbd>Z</kbd>…<kbd>/</kbd>: white keys one octave lower<br>
      <kbd>↑</kbd><kbd>↓</kbd> octave · <kbd>←</kbd><kbd>→</kbd> previous/next channel</div>
    <div><h3>Chords on the number row</h3>
      <kbd>1</kbd>…<kbd>0</kbd> play ten chords that sit well together in the current key.<br>
      <kbd>Shift</kbd>+number: Murmur's spice chords (borrowed, Neapolitan, tritone subs).<br>
      <kbd>Ctrl</kbd>+number: stamp the chord into the piano roll at the edit cursor.</div>
    <div><h3>Transport</h3>
      <kbd>Space</kbd> play / pause · <kbd>Ctrl</kbd>+<kbd>L</kbd> toggles pattern / song mode<br>
      <kbd>Ctrl</kbd>+<kbd>R</kbd> record from keys/MIDI<br>
      <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> undo / redo (Murmur's moves too)<br>
      <kbd>Ctrl</kbd>+<kbd>S</kbd> save a version · <kbd>Ctrl</kbd>+<kbd>E</kbd> render WAV<br>
      <kbd>-</kbd> / <kbd>=</kbd> previous / next pattern</div>
    <div><h3>Piano roll</h3>
      Click: add · drag: move · drag right edge: length · right-click: delete<br>
      <kbd>Ctrl</kbd>+click: add to selection · <kbd>Ctrl</kbd>+<kbd>A</kbd> select all · <kbd>Del</kbd> delete<br>
      <kbd>Alt</kbd>: no snap · wheel: scroll · <kbd>Ctrl</kbd>+wheel: zoom · <kbd>Shift</kbd>+wheel: sideways<br>
      <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> transpose selection<br>
      Drag in the velocity lane to set velocity.</div>
    <div><h3>Channel rack</h3>
      Click steps to toggle, Shift+click for an accent, right-click a step to hear it.<br>
      Click a channel name to select it, double-click to open its instrument, right-click for options.<br>
      Green dot: mute (right-click: solo). Small number: mixer insert.</div>
  </div>`;
  return {};
}
