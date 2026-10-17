// Abyss -- ten-rite reverb for GRIMOIRE 9990.
//
// Every algorithm is a seeded, synthetic impulse response generated
// synchronously (OfflineAudioContext safe) and played through a
// ConvolverNode. Character comes from how each IR is shaped:
//   - decay curve (exponential, gated, reversed swell, slow-bloom)
//   - early reflection pattern (discrete noise bursts, count/spread per room)
//   - stereo decorrelation (shared vs independent noise per channel)
//   - frequency-dependent damping (noise split into a low and a high band by a
//     one-pole filter; each band gets its own decay time)
//   - baked modulation (slow amplitude drift), spring dispersion, shimmer partials
// Around the convolver sit realtime controls: pre-delay, low cut, high cut
// (damping), a chorus-like LFO-modulated short delay, M/S width, optional
// input-keyed ducking, and an equal-power dry/wet crossfade.
// Changing decay/size/algorithm regenerates the IR (debounced) and
// crossfades from the old convolver to a new one, so there is no click.

import { knob, select, section, el } from '../ui/widgets.js';
import { mulberry32 } from '../audio/rng.js';

export const meta = {
  id: 'abyss',
  name: 'Abyss',
  kind: 'fx',
  description: 'Ten-rite reverb: seeded impulse responses from a small temple room to the Void.',
};

const TAU = Math.PI * 2;
const MAX_IR_SECONDS = 16;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Web Audio reads Q of lowpass/highpass biquads in dB: Butterworth (linear 0.7071) is -3.01 dB.
const BUTTER_Q_DB = -3.0103;

// shape: 'exp' | 'gate' | 'reverse' | 'spring' | 'shimmer'
// er*: early reflections (count, first/last time in s at size 0.5, gain)
// attack: diffuse build-up time constant (s); xover: low/high split (Hz)
// lfRatio / hfRatio: decay-time multipliers for the low and high band
// corr: L/R noise correlation (0 = fully decorrelated)
// amod/amodRate: baked slow amplitude modulation of the tail
// level: wet trim (normalize=true equalizes IR power, but long dark IRs still sound louder)
export const ALGORITHMS = [
  { id: 'cathedral', name: 'Cathedral of Nine', blurb: 'Nine stone reflections, then a long dark nave.',
    shape: 'exp', decay: 5.5, maxDecay: 14, er: 9, erStart: 0.019, erEnd: 0.19, erGain: 1.4,
    attack: 0.07, xover: 2200, lfRatio: 1.25, hfRatio: 0.45, lowGain: 1.1, highGain: 0.7,
    corr: 0.05, amod: 0.04, amodRate: 0.21, level: 0.7, salt: 9 },
  { id: 'astral', name: 'Astral Hall', blurb: 'A smooth concert hall floating a little above the earth.',
    shape: 'exp', decay: 3.2, maxDecay: 12, er: 12, erStart: 0.008, erEnd: 0.085, erGain: 0.9,
    attack: 0.03, xover: 3500, lfRatio: 1.05, hfRatio: 0.65, lowGain: 1, highGain: 0.85,
    corr: 0, amod: 0.08, amodRate: 0.33, salt: 11 },
  { id: 'plate', name: 'Gold Plate', blurb: 'Instant, dense, bright metal. Vocals and snares.',
    shape: 'exp', decay: 2.2, maxDecay: 8, er: 0,
    attack: 0.0015, xover: 5000, lfRatio: 0.85, hfRatio: 0.9, lowGain: 0.8, highGain: 1.15,
    corr: 0.15, amod: 0, salt: 21 },
  { id: 'velvet', name: 'Velvet Chamber', blurb: 'Warm velvet-noise chamber, soft highs.',
    shape: 'exp', velvet: 1800, decay: 1.6, maxDecay: 6, er: 8, erStart: 0.005, erEnd: 0.042, erGain: 1.1,
    attack: 0.012, xover: 1800, lfRatio: 1.1, hfRatio: 0.5, lowGain: 1.1, highGain: 0.6,
    corr: 0.1, amod: 0, salt: 33 },
  { id: 'temple', name: 'Small Temple Room', blurb: 'Close walls, many quick reflections.',
    shape: 'exp', decay: 0.8, maxDecay: 3, er: 14, erStart: 0.002, erEnd: 0.026, erGain: 1.2,
    attack: 0.004, xover: 2800, lfRatio: 1, hfRatio: 0.6, lowGain: 1, highGain: 0.8,
    corr: 0.2, amod: 0, salt: 44 },
  { id: 'spring', name: 'Spring of Hermes', blurb: 'Dispersive chirp and metallic recirculation.',
    shape: 'spring', decay: 2.4, maxDecay: 6, er: 0,
    attack: 0.002, xover: 2500, lfRatio: 0.9, hfRatio: 0.55, lowGain: 0.7, highGain: 1,
    corr: 0.7, amod: 0.05, amodRate: 4.5, salt: 55 },
  { id: 'shimmer', name: 'Shimmer Ascension', blurb: 'Bright, long; a rising choir of upper partials.',
    shape: 'shimmer', decay: 7, maxDecay: 14, er: 6, erStart: 0.01, erEnd: 0.06, erGain: 0.6,
    attack: 0.09, xover: 4000, lfRatio: 0.8, hfRatio: 1.15, lowGain: 0.7, highGain: 1.2,
    corr: 0, amod: 0.1, amodRate: 0.17, salt: 66 },
  { id: 'gated', name: 'Gated Sigil', blurb: 'Eighties gate: a dense burst cut clean.',
    shape: 'gate', decay: 0.42, minDecay: 0.12, maxDecay: 1.2, er: 10, erStart: 0.003, erEnd: 0.03, erGain: 1,
    attack: 0.003, xover: 3000, lfRatio: 1, hfRatio: 1, lowGain: 1.05, highGain: 0.9,
    corr: 0.05, amod: 0, salt: 77 },
  { id: 'reverse', name: 'Reverse Veil', blurb: 'A swell that rises into the note.',
    shape: 'reverse', decay: 1.8, minDecay: 0.2, maxDecay: 4, er: 0,
    attack: 0, xover: 2500, lfRatio: 1, hfRatio: 1, lowGain: 1, highGain: 0.9,
    corr: 0, amod: 0.06, amodRate: 0.5, salt: 88 },
  { id: 'void', name: 'Void', blurb: 'Huge, dark, slowly breathing. Nearly a freeze.',
    shape: 'exp', decay: 13, maxDecay: 15, er: 0,
    attack: 0.28, xover: 1100, lfRatio: 1.1, hfRatio: 0.28, lowGain: 1.2, highGain: 0.45,
    corr: 0, amod: 0.35, amodRate: 0.11, amod2: 0.2, amodRate2: 0.037, level: 0.45, salt: 99 },
];

const findAlgo = id => ALGORITHMS.find(a => a.id === id) || ALGORITHMS[1];

const DEFAULTS = {
  algorithm: 'astral',
  mix: 0.3,
  decay: 3.2,      // seconds (RT60; gate length for Gated, swell length for Reverse)
  size: 0.5,       // 0..1: early-reflection spread and build-up time
  predelay: 20,    // ms
  damping: 9000,   // Hz, high cut on the wet signal
  lowcut: 120,     // Hz, low cut before the convolver
  width: 1,        // 0..2 (0 = mono, 1 = as generated, 2 = extra wide)
  mod: 0.25,       // 0..1 chorus depth on the wet signal
  modRate: 0.45,   // Hz
  duck: 0,         // 0..1 how much the input ducks the tail
  seed: 9990,
};
const IR_KEYS = new Set(['algorithm', 'decay', 'size', 'seed']);

function makeNoise(rng, n, sr, velvetDensity) {
  const a = new Float32Array(n);
  if (velvetDensity) {
    // Velvet noise: one +-1 impulse at a random spot in each short window.
    const step = Math.max(2, Math.floor(sr / velvetDensity));
    const g = Math.sqrt(step) * 0.577; // match white-noise RMS roughly
    for (let k = 0; k < n; k += step) {
      const idx = k + Math.floor(rng() * step);
      if (idx < n) a[idx] = (rng() < 0.5 ? -g : g);
    }
  } else {
    for (let i = 0; i < n; i++) a[i] = rng() * 2 - 1;
  }
  return a;
}

// Build one stereo impulse response. Synchronous, seeded, deterministic.
export function generateIR(ctx, algo, decaySec, size, seed = 9990) {
  const sr = ctx.sampleRate;
  const s = 0.5 + clamp(size, 0, 1);
  const rt = clamp(decaySec, algo.minDecay || 0.1, algo.maxDecay || 12);
  let len;
  if (algo.shape === 'gate') len = rt + 0.005;
  else if (algo.shape === 'reverse') len = rt;
  else len = rt * 1.1 + (algo.erEnd || 0) * s + 0.05;
  len = Math.min(len, MAX_IR_SECONDS);
  const N = Math.max(256, Math.floor(len * sr));
  const buf = ctx.createBuffer(2, N, sr);

  const base = ((seed >>> 0) ^ Math.imul(algo.salt, 0x9E3779B1)) >>> 0;
  const common = makeNoise(mulberry32(base), N, sr, algo.velvet);
  const kL = 6.9078 / (rt * algo.lfRatio);
  const kH = 6.9078 / (rt * algo.hfRatio);
  const kR = 6.9078 / (rt * 0.6);   // reverse swell, low band
  const kRH = 6.9078 / (rt * 0.4);  // reverse swell, high band (brightens at the end)
  const atk = algo.attack * s;
  const aLP = Math.exp(-TAU * Math.min(algo.xover, sr * 0.45) / sr);
  const c = clamp(algo.corr, 0, 1), cc = Math.sqrt(1 - c * c);

  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32((base + 7919 * (ch + 1)) >>> 0);
    const own = makeNoise(rng, N, sr, algo.velvet);
    const out = buf.getChannelData(ch);
    const ph1 = rng() * TAU, ph2 = rng() * TAU;
    let lp = 0;

    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const n = c * common[i] + cc * own[i];
      lp += (1 - aLP) * (n - lp);
      const lo = lp, hi = n - lp;
      let eL, eH;
      if (algo.shape === 'gate') {
        const b = 1 - Math.exp(-t / Math.max(atk, 1e-4));
        const body = 1 - 0.3 * t / rt;
        const f = t > rt - 0.008 ? Math.max(0, (rt - t) / 0.008) : 1;
        eL = b * body * f;
        eH = eL * Math.exp(-2.5 * t / rt);
      } else if (algo.shape === 'reverse') {
        const d = Math.max(0, rt - t);
        const f = d < 0.004 ? d / 0.004 : 1;
        eL = Math.exp(-kR * d) * f;
        eH = Math.exp(-kRH * d) * f;
      } else {
        const b = atk > 0 ? 1 - Math.exp(-t / atk) : 1;
        eL = b * Math.exp(-kL * t);
        eH = b * Math.exp(-kH * t);
        if (algo.shape === 'shimmer') eH *= 0.35 + 0.65 * (1 - Math.exp(-t / (0.8 * s)));
      }
      let v = algo.lowGain * lo * eL + algo.highGain * hi * eH;
      if (algo.amod) v *= 1 + algo.amod * Math.sin(TAU * algo.amodRate * t + ph1);
      if (algo.amod2) v *= 1 + algo.amod2 * Math.sin(TAU * algo.amodRate2 * t + ph2);
      out[i] = v;
    }

    // Early reflections: short decaying noise bursts, jittered per channel.
    if (algo.er) {
      const span = (algo.erEnd - algo.erStart) * s;
      const burst = Math.max(8, Math.floor(0.0012 * sr));
      for (let k = 0; k < algo.er; k++) {
        const frac = (k + 0.5) / algo.er;
        const tt = (algo.erStart * s + span * Math.pow(frac, 1.3)) * (1 + (rng() - 0.5) * 0.3);
        const idx = Math.floor(tt * sr);
        const amp = algo.erGain * (1 - 0.6 * frac);
        for (let j = 0; j < burst && idx + j < N; j++) {
          out[idx + j] += amp * (rng() * 2 - 1) * Math.exp(-3 * j / burst);
        }
      }
    }

    // Spring: a dispersive downward chirp, recirculated by a comb (the coil round trip).
    if (algo.shape === 'spring') {
      const cl = Math.min(N, Math.floor(0.03 * sr));
      let phase = 0;
      for (let j = 0; j < cl; j++) {
        const tj = j / sr;
        phase += TAU * (250 + 3800 * Math.exp(-tj / 0.007)) / sr;
        out[j] += 0.9 * Math.sin(phase) * Math.exp(-tj / 0.012);
      }
      const D = Math.max(1, Math.floor((0.029 + 0.0021 * ch) * s * sr));
      for (let i = D; i < N; i++) out[i] += 0.5 * out[i - D];
    }

    // Shimmer: a convolver is linear, so it cannot pitch the input up an octave.
    // Instead the tail carries a cluster of high partials that swell in slowly and
    // glide upward a little: the "ascending choir" impression of a shimmer verb.
    if (algo.shape === 'shimmer') {
      const kS = 6.9078 / (rt * 1.25);
      const dS = Math.exp(-kS / sr);
      for (let p = 0; p < 16; p++) {
        const f0 = 1800 * Math.pow(2, rng() * 2.3);
        const amp = 0.05 * (0.5 + rng());
        const swellK = Math.exp(-1 / ((0.6 + rng() * 0.9) * s * sr));
        let phase = rng() * TAU;
        if (f0 * 1.02 > sr * 0.45) continue;
        let dec = 1, sw = 1;
        for (let i = 0; i < N; i++) {
          phase += TAU * f0 * (1 + 0.012 * i / N) / sr;
          dec *= dS; sw *= swellK;
          out[i] += amp * (1 - sw) * dec * Math.sin(phase);
        }
      }
    }

    // Fade the very end so truncation never clicks.
    if (algo.shape !== 'gate' && algo.shape !== 'reverse') {
      const fl = Math.min(Math.floor(0.08 * sr), Math.floor(N / 4));
      for (let j = 0; j < fl; j++) out[N - 1 - j] *= j / fl;
    }
  }
  return buf;
}

function absCurve() {
  const n = 1025, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.abs(i / (n - 1) * 2 - 1);
  return c;
}
function negClampCurve() { // y = -clamp(x, 0, 1)
  const n = 1025, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = -Math.max(0, i / (n - 1) * 2 - 1);
  return c;
}

const STYLE_ID = 'gk-style-abyss';
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.gk-plugin-abyss .abyss-blurb { font-style: italic; opacity: .75; font-size: 11px; max-width: 260px; align-self: center; }
.gk-plugin-abyss .abyss-sigil { font-size: 11px; letter-spacing: .3em; opacity: .55; text-align: center; margin: 2px 0 6px; }
`;
  document.head.appendChild(st);
}

export function create(ctx, saved) {
  const state = { ...DEFAULTS };
  const isOffline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const nyq = ctx.sampleRate * 0.45;

  const input = ctx.createGain();
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry); dry.connect(output);

  const pre = ctx.createDelay(0.5);
  const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.Q.value = BUTTER_Q_DB;
  const highCut = ctx.createBiquadFilter(); highCut.type = 'lowpass'; highCut.Q.value = BUTTER_Q_DB;
  input.connect(pre); pre.connect(lowCut);
  // convolver(s) live between lowCut and highCut (see regenerate)

  // Modulation: two short delays wobbled in opposite directions by one LFO.
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const modL = ctx.createDelay(0.02), modR = ctx.createDelay(0.02);
  modL.delayTime.value = 0.004; modR.delayTime.value = 0.004;
  highCut.connect(split);
  split.connect(modL, 0); split.connect(modR, 1);
  const lfo = ctx.createOscillator(); lfo.type = 'sine';
  const lfoL = ctx.createGain(), lfoR = ctx.createGain();
  lfo.connect(lfoL); lfoL.connect(modL.delayTime);
  lfo.connect(lfoR); lfoR.connect(modR.delayTime);
  lfo.start();

  // Width: L' = a L + b R, R' = b L + a R with a = (1+w)/2, b = (1-w)/2 (M/S scaling).
  const wLL = ctx.createGain(), wLR = ctx.createGain(), wRL = ctx.createGain(), wRR = ctx.createGain();
  modL.connect(wLL); wLL.connect(merge, 0, 0);
  modL.connect(wLR); wLR.connect(merge, 0, 1);
  modR.connect(wRL); wRL.connect(merge, 0, 0);
  modR.connect(wRR); wRR.connect(merge, 0, 1);

  // Ducking: |input| -> 6 Hz lowpass -> sensitivity -> clamp to [0,1] -> depth -> ducker.gain.
  // ducker.gain = 1 - depth * clamp(env), never below 1 - 0.85.
  const ducker = ctx.createGain();
  const envRect = ctx.createWaveShaper(); envRect.curve = absCurve();
  const envLP = ctx.createBiquadFilter(); envLP.type = 'lowpass'; envLP.frequency.value = 6; envLP.Q.value = -6.02; // linear Q 0.5, no overshoot
  const duckSens = ctx.createGain(); duckSens.gain.value = 4;
  const duckClamp = ctx.createWaveShaper(); duckClamp.curve = negClampCurve();
  const duckDepth = ctx.createGain(); duckDepth.gain.value = 0;
  input.connect(envRect); envRect.connect(envLP); envLP.connect(duckSens);
  duckSens.connect(duckClamp); duckClamp.connect(duckDepth); duckDepth.connect(ducker.gain);

  merge.connect(ducker); ducker.connect(wet); wet.connect(output);

  const P = (param, v, imm, tc = 0.02) => {
    if (imm) param.value = v; else param.setTargetAtTime(v, ctx.currentTime, tc);
  };

  function apply(key, imm) {
    const s = state;
    switch (key) {
      case 'mix': {
        const m = clamp(s.mix, 0, 1);
        P(dry.gain, Math.cos(m * Math.PI / 2), imm);
        P(wet.gain, Math.sin(m * Math.PI / 2), imm);
        break;
      }
      case 'predelay': P(pre.delayTime, clamp(s.predelay, 0, 250) / 1000, imm); break;
      case 'damping': P(highCut.frequency, clamp(s.damping, 500, nyq), imm); break;
      case 'lowcut': P(lowCut.frequency, clamp(s.lowcut, 10, 2000), imm); break;
      case 'width': {
        const w = clamp(s.width, 0, 2), a = 0.5 * (1 + w), b = 0.5 * (1 - w);
        P(wLL.gain, a, imm); P(wRR.gain, a, imm); P(wLR.gain, b, imm); P(wRL.gain, b, imm);
        break;
      }
      case 'mod': {
        const d = clamp(s.mod, 0, 1) * 0.0025;
        P(lfoL.gain, d, imm); P(lfoR.gain, -d, imm);
        break;
      }
      case 'modRate': P(lfo.frequency, clamp(s.modRate, 0.05, 5), imm); break;
      case 'duck': P(duckDepth.gain, clamp(s.duck, 0, 1) * 0.85, imm); break;
    }
  }

  // --- IR management: new convolver per regeneration, crossfaded in. ---
  let active = null;
  let regenTimer = 0;
  const pendingKills = new Set();
  function kill(node) {
    try { lowCut.disconnect(node.conv); } catch (e) { /* already gone */ }
    try { node.conv.disconnect(); } catch (e) { /* noop */ }
    try { node.g.disconnect(); } catch (e) { /* noop */ }
  }
  function regenerate(hard) {
    const algo = findAlgo(state.algorithm);
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = generateIR(ctx, algo, state.decay, state.size, state.seed);
    const g = ctx.createGain();
    const level = algo.level || 1;
    lowCut.connect(conv); conv.connect(g); g.connect(highCut);
    const old = active;
    active = { conv, g };
    if (!old || hard) {
      g.gain.value = level;
      if (old) kill(old);
    } else {
      const t = ctx.currentTime;
      g.gain.value = 0;
      g.gain.setTargetAtTime(level, t, 0.06);
      old.g.gain.setTargetAtTime(0, t, 0.06);
      const id = setTimeout(() => { pendingKills.delete(id); kill(old); }, 500);
      pendingKills.add(id);
    }
  }
  function scheduleRegen() {
    clearTimeout(regenTimer);
    if (isOffline) { regenTimer = 0; regenerate(true); return; }
    regenTimer = setTimeout(() => { regenTimer = 0; regenerate(false); }, 140);
  }

  function coerce(key, v) {
    if (key === 'algorithm') return findAlgo(String(v)).id;
    const n = Number(v);
    return Number.isFinite(n) ? n : state[key];
  }

  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (k in saved) state[k] = coerce(k, saved[k]);
  }
  for (const k of Object.keys(DEFAULTS)) apply(k, true);
  regenerate(true);

  let ui = null;
  function syncUI(key) {
    if (!ui) return;
    if (ui[key]) ui[key].set(state[key]);
    if (key === 'algorithm' && ui.blurb) ui.blurb.textContent = findAlgo(state.algorithm).blurb;
  }

  const api = {
    id: meta.id, name: meta.name, kind: 'fx',
    input, output,
    getState: () => ({ ...state }),
    setState(obj) {
      if (!obj || typeof obj !== 'object') return;
      let irDirty = false;
      for (const k of Object.keys(DEFAULTS)) {
        if (!(k in obj)) continue;
        const v = coerce(k, obj[k]);
        if (v === state[k]) continue;
        state[k] = v;
        if (IR_KEYS.has(k)) irDirty = true; else apply(k, false);
        syncUI(k);
      }
      if (irDirty) { clearTimeout(regenTimer); regenTimer = 0; regenerate(isOffline); }
    },
    set(key, value) {
      if (!(key in DEFAULTS)) return;
      state[key] = coerce(key, value);
      if (IR_KEYS.has(key)) scheduleRegen(); else apply(key, false);
      syncUI(key);
    },
    renderUI(container) {
      ensureStyle();
      const root = el('div', 'gk-plugin-abyss abyss-root');
      container.appendChild(root);
      root.appendChild(el('div', 'abyss-sigil', '∴ ABYSS · 9990 ∴'));
      const pct = x => Math.round(x * 100) + '%';
      const hz = x => (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x)) + ' Hz';
      const sec = x => (x < 1 ? Math.round(x * 1000) + ' ms' : x.toFixed(1) + ' s');
      ui = {};

      const rite = section(root, 'Rite');
      ui.algorithm = select(rite, {
        label: 'Algorithm',
        options: ALGORITHMS.map(a => ({ label: a.name, value: a.id })),
        value: state.algorithm,
        onChange: v => { api.set('algorithm', v); api.set('decay', findAlgo(v).decay); },
      });
      ui.blurb = el('div', 'abyss-blurb', findAlgo(state.algorithm).blurb);
      rite.appendChild(ui.blurb);

      const K = (row, key, label, min, max, format, step = 0) => {
        ui[key] = knob(row, { label, min, max, step, value: state[key], def: DEFAULTS[key], format,
          onChange: v => api.set(key, v) });
      };
      const space = section(root, 'Space');
      K(space, 'decay', 'Decay', 0.1, 20, sec);
      K(space, 'size', 'Size', 0, 1, pct);
      K(space, 'predelay', 'Pre-delay', 0, 250, x => Math.round(x) + ' ms', 1);
      const tone = section(root, 'Tone');
      K(tone, 'damping', 'High cut', 1000, 20000, hz);
      K(tone, 'lowcut', 'Low cut', 20, 1000, hz);
      const motion = section(root, 'Motion & Image');
      K(motion, 'mod', 'Mod depth', 0, 1, pct);
      K(motion, 'modRate', 'Mod rate', 0.05, 5, x => x.toFixed(2) + ' Hz');
      K(motion, 'width', 'Width', 0, 2, pct);
      K(motion, 'duck', 'Duck', 0, 1, pct);
      const blend = section(root, 'Blend');
      K(blend, 'mix', 'Mix', 0, 1, pct);
    },
    dispose() {
      clearTimeout(regenTimer);
      for (const id of pendingKills) clearTimeout(id);
      pendingKills.clear();
      try { lfo.stop(); } catch (e) { /* noop */ }
      if (active) kill(active);
      active = null;
      for (const n of [input, output, dry, wet, pre, lowCut, highCut, split, merge, modL, modR, lfo, lfoL, lfoR,
        wLL, wLR, wRL, wRR, ducker, envRect, envLP, duckSens, duckClamp, duckDepth]) {
        try { n.disconnect(); } catch (e) { /* noop */ }
      }
      ui = null;
    },
  };
  return api;
}
