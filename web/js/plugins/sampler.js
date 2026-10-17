// Sampler: plays one of your own audio files as an instrument. One-shot mode
// suits drums and vocal chops; sustain mode loops the middle while a key is held.
import { knob, toggle, section, el } from '../ui/widgets.js';

export const meta = { id: 'sampler', name: 'Sampler', kind: 'instrument', description: 'Play your own samples, pitched or as one-shots' };

const DEFAULTS = { sampleId: null, name: '', gain: 0.9, root: 60, tune: 0, start: 0, attack: 0.002, release: 0.12, oneShot: true, reverse: false, cutoff: 20000 };
const reversed = new WeakMap();

// env.getBuffer(id) is supplied by the engine (buffers are decoded asynchronously).
export function create(ctx, state, env = {}) {
  const p = Object.assign({}, DEFAULTS, state || {});
  const output = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.connect(output);
  const voices = new Map(); // midi -> [voice]
  const all = new Set();

  const buffer = () => {
    const b = env.getBuffer ? env.getBuffer(p.sampleId) : null;
    if (!b || !p.reverse) return b;
    if (!reversed.has(b)) {
      const r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
      for (let c = 0; c < b.numberOfChannels; c++) r.getChannelData(c).set(b.getChannelData(c).slice().reverse());
      reversed.set(b, r);
    }
    return reversed.get(b);
  };

  function apply() {
    output.gain.setTargetAtTime(p.gain, ctx.currentTime, 0.01);
    filter.frequency.setTargetAtTime(p.cutoff, ctx.currentTime, 0.01);
  }
  apply();

  function noteOn(midi, vel = 0.85, time = ctx.currentTime) {
    const b = buffer();
    if (!b) return;
    if (all.size >= 24) { const v = all.values().next().value; stopVoice(v, time); }
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = Math.pow(2, (midi - p.root + p.tune) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vel, time + Math.max(0.001, p.attack));
    src.connect(g).connect(filter);
    const offset = p.start * b.duration;
    if (!p.oneShot) { src.loop = true; src.loopStart = offset + (b.duration - offset) * 0.35; src.loopEnd = b.duration - 0.01; }
    src.start(time, offset);
    const v = { src, g, midi };
    all.add(v);
    if (!voices.has(midi)) voices.set(midi, []);
    voices.get(midi).push(v);
    src.onended = () => { all.delete(v); const arr = voices.get(midi); if (arr) arr.splice(arr.indexOf(v), 1); g.disconnect(); };
  }
  function stopVoice(v, time) {
    const r = Math.max(0.005, p.release);
    v.g.gain.cancelScheduledValues(time);
    v.g.gain.setTargetAtTime(0, time, r / 4);
    try { v.src.stop(time + r * 1.5); } catch { }
  }
  function noteOff(midi, time = ctx.currentTime) {
    if (p.oneShot) return; // one-shots ring out
    const arr = voices.get(midi);
    if (arr && arr.length) stopVoice(arr.shift(), time);
  }

  return {
    id: 'sampler', name: p.name || 'Sampler', kind: 'instrument', output,
    noteOn, noteOff,
    playNote(midi, vel, time, dur) {
      noteOn(midi, vel, time);
      if (!p.oneShot) { const arr = voices.get(midi); const v = arr && arr[arr.length - 1]; if (v) stopVoice(v, time + dur); }
    },
    allNotesOff(time = ctx.currentTime) { for (const v of [...all]) stopVoice(v, time); },
    getState: () => ({ ...p }),
    setState(s) { Object.assign(p, s); apply(); },
    set(k, v) { p[k] = v; apply(); },
    renderUI(c) {
      const wave = el('canvas');
      wave.width = 520; wave.height = 80;
      wave.style.cssText = 'width:100%;max-width:520px;height:80px;background:#05060a;border:1px solid var(--line);border-radius:4px';
      c.appendChild(el('div', 'gk-section-title', p.name || 'No sample loaded'));
      c.appendChild(wave);
      const draw = () => {
        const g = wave.getContext('2d'), b = buffer();
        g.clearRect(0, 0, wave.width, wave.height);
        if (!b) return;
        const d = b.getChannelData(0), step = Math.ceil(d.length / wave.width);
        g.fillStyle = '#8ad8ff';
        for (let x = 0; x < wave.width; x++) {
          let m = 0; for (let j = 0; j < step; j++) m = Math.max(m, Math.abs(d[x * step + j] || 0));
          g.fillRect(x, 40 - m * 38, 1, Math.max(1, m * 76));
        }
        g.fillStyle = 'rgba(255,215,138,.8)'; g.fillRect(p.start * wave.width, 0, 2, 80);
      };
      draw();
      const r = section(c, 'Play');
      knob(r, { label: 'Gain', min: 0, max: 1.5, value: p.gain, def: 0.9, onChange: v => this.set('gain', v) });
      knob(r, { label: 'Root', min: 24, max: 96, step: 1, value: p.root, def: 60, onChange: v => this.set('root', v), format: v => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][v % 12] + (Math.floor(v / 12) - 1) });
      knob(r, { label: 'Tune', min: -12, max: 12, step: 0.01, value: p.tune, def: 0, onChange: v => this.set('tune', v), format: v => v.toFixed(2) + 'st' });
      knob(r, { label: 'Start', min: 0, max: 0.95, value: p.start, def: 0, onChange: v => { this.set('start', v); draw(); }, format: v => Math.round(v * 100) + '%' });
      const r2 = section(c, 'Shape');
      knob(r2, { label: 'Attack', min: 0.001, max: 1, value: p.attack, def: 0.002, onChange: v => this.set('attack', v), format: v => Math.round(v * 1000) + 'ms' });
      knob(r2, { label: 'Release', min: 0.005, max: 3, value: p.release, def: 0.12, onChange: v => this.set('release', v), format: v => Math.round(v * 1000) + 'ms' });
      knob(r2, { label: 'Cutoff', min: 200, max: 20000, value: p.cutoff, def: 20000, onChange: v => this.set('cutoff', v) });
      toggle(r2, { label: 'One-shot', value: p.oneShot, onChange: v => this.set('oneShot', v) });
      toggle(r2, { label: 'Reverse', value: p.reverse, onChange: v => { this.set('reverse', v); draw(); } });
    },
    dispose() { for (const v of [...all]) { try { v.src.stop(); } catch { } } output.disconnect(); },
  };
}
