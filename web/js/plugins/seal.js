// Seal -- the final sigil on a track. Mastering suite for GRIMOIRE 9990.
//
// Signal flow:
//   input -> trim -> EQ (low shelf, low-mid bell, high-mid bell, high shelf)
//   -> 3-band split (Linkwitz-Riley 4th order: two cascaded Butterworth biquads per
//      side; the low band gets a 2nd-order allpass at the upper crossover so the
//      three bands sum flat in magnitude)
//   -> per band: DynamicsCompressor -> gain (with the compressor's automatic makeup
//      cancelled) -> M/S width (0..200%)
//   -> mono bass (side channel high-passed at ~120 Hz, so lows stay mono-safe)
//   -> exciter / saturation (parallel tanh with a gloss shelf, drive + mix)
//   -> maximizer: input gain -> fast high-ratio compressor at the ceiling
//      -> soft-knee safety clip WaveShaper at the ceiling
//   -> output (with a bypass crossfade).
// Meters (peak, correlation, width, limiter reduction) are created in renderUI only.

import { knob, select, toggle, section, meter, el } from '../ui/widgets.js';

export const meta = {
  id: 'seal',
  name: 'Seal',
  kind: 'fx',
  description: 'Mastering suite: EQ, 3-band dynamics, imager, exciter and maximizer, with presets.',
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dB = d => Math.pow(10, d / 20);
// Chromium/Firefox DynamicsCompressor applies makeup = (1 / gainAt0dBFS) ^ 0.6,
// i.e. -0.6 * thr * (1 - 1/ratio) dB for a hard knee. Measured in Chrome: a soft
// knee behaves like a threshold raised by knee/2.
const compMakeupDb = (thr, ratio, knee = 0) => -0.6 * Math.min(0, thr + knee / 2) * (1 - 1 / Math.max(1, ratio));
// Web Audio reads Q of lowpass/highpass biquads in dB: Butterworth (linear 0.7071) is -3.01 dB.
const BUTTER_Q_DB = -3.0103;

// key: [min, max, default]
const SPEC = {
  inGain: [-12, 12, 0],
  lsFreq: [30, 300, 90], lsGain: [-12, 12, 0],
  lmFreq: [120, 1200, 300], lmGain: [-12, 12, 0], lmQ: [0.2, 6, 0.9],
  hmFreq: [1000, 9000, 3500], hmGain: [-12, 12, 0], hmQ: [0.2, 6, 0.9],
  hsFreq: [4000, 18000, 10000], hsGain: [-12, 12, 0],
  xLow: [60, 400, 160], xHigh: [1500, 8000, 3200],
  lowThr: [-48, 0, -18], lowRatio: [1, 10, 2], lowGain: [-12, 12, 0], lowWidth: [0, 2, 1],
  midThr: [-48, 0, -18], midRatio: [1, 10, 1.6], midGain: [-12, 12, 0], midWidth: [0, 2, 1],
  highThr: [-48, 0, -20], highRatio: [1, 10, 1.6], highGain: [-12, 12, 0], highWidth: [0, 2, 1],
  monoFreq: [40, 250, 120],
  exDrive: [0, 1, 0.15], exMix: [0, 1, 0],
  maxIn: [0, 18, 0], ceiling: [-6, 0, -1], release: [0.01, 1, 0.12],
};
const DEFAULTS = { preset: 'Transparent', bypass: false, monoBass: true };
for (const [k, [, , d]] of Object.entries(SPEC)) DEFAULTS[k] = d;

const BAND_KNEE = 6;
const BANDS = [
  { key: 'low', attack: 0.03, release: 0.25 },
  { key: 'mid', attack: 0.015, release: 0.18 },
  { key: 'high', attack: 0.005, release: 0.1 },
];

export const PRESETS = [
  { name: 'Transparent', description: 'Barely there: gentle control and a safe ceiling.',
    params: { maxIn: 2, ceiling: -1, release: 0.15, lowRatio: 1.5, midRatio: 1.3, highRatio: 1.3, exMix: 0 } },
  { name: 'Drill Night', description: 'Punchy lows, crisp hats.',
    params: { lsFreq: 60, lsGain: 2.5, lmFreq: 280, lmGain: -2, hmFreq: 4000, hmGain: 1, hsFreq: 11000, hsGain: 2,
      xLow: 150, xHigh: 4000,
      lowThr: -20, lowRatio: 3, lowGain: 1.5, lowWidth: 0.6,
      midThr: -18, midRatio: 2, midGain: 0, midWidth: 1,
      highThr: -24, highRatio: 2.5, highGain: 1.5, highWidth: 1.3,
      monoBass: true, monoFreq: 140, exDrive: 0.3, exMix: 0.2, maxIn: 5, ceiling: -0.8, release: 0.08 } },
  { name: 'Anthem', description: 'Wide and loud.',
    params: { lsGain: 1.5, lmGain: -1.5, hmGain: 1.5, hsGain: 2.5,
      lowThr: -20, lowRatio: 2.5, lowGain: 0.5, lowWidth: 0.9,
      midThr: -20, midRatio: 2, midGain: 0, midWidth: 1.35,
      highThr: -22, highRatio: 2, highGain: 1, highWidth: 1.6,
      monoBass: true, monoFreq: 120, exDrive: 0.35, exMix: 0.25, maxIn: 7, ceiling: -0.5, release: 0.1 } },
  { name: 'Stream Safe', description: 'Gentle, aims near -14 LUFS for typical mixes (no true LUFS meter).',
    params: { lsGain: 0.5, lmGain: -0.5, hmGain: 0.5, hsGain: 1,
      lowThr: -16, lowRatio: 1.5, midThr: -16, midRatio: 1.5, highThr: -18, highRatio: 1.5,
      lowWidth: 1, midWidth: 1.1, highWidth: 1.15,
      monoBass: true, exDrive: 0.15, exMix: 0.08, maxIn: 1, ceiling: -1.5, release: 0.2 } },
  { name: '9990 Good Ending', description: 'Warm, wide, glossy.',
    params: { lsFreq: 100, lsGain: 2, lmFreq: 350, lmGain: -1, hmFreq: 2500, hmGain: 0.5, hsFreq: 12000, hsGain: 3,
      lowThr: -18, lowRatio: 2, lowGain: 0.5, lowWidth: 1,
      midThr: -18, midRatio: 1.8, midGain: 0, midWidth: 1.25,
      highThr: -20, highRatio: 1.8, highGain: 0.5, highWidth: 1.45,
      monoBass: true, monoFreq: 120, exDrive: 0.45, exMix: 0.3, maxIn: 4, ceiling: -1, release: 0.15 } },
];

// Parallel saturation: y = tanh(k x)/k (unity for small signals, rounds off peaks).
function satCurve(drive) {
  const k = 0.2 + 4 * clamp(drive, 0, 1);
  const n = 4097, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / k;
  return c;
}
// Safety clip: linear up to 85% of the ceiling, then a tanh knee that never exceeds it.
// Input beyond +-1 is clamped by the WaveShaper to the curve ends (= +-ceiling).
function clipCurve(ceilDb) {
  const c = dB(ceilDb), k0 = 0.85 * c, room = c - k0;
  const n = 8193, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1, ax = Math.abs(x);
    const y = ax <= k0 ? ax : k0 + room * Math.tanh((ax - k0) / room);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

const STYLE_ID = 'gk-style-seal';
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.gk-plugin-seal .seal-sigil { font-size: 11px; letter-spacing: .3em; opacity: .55; text-align: center; margin: 2px 0 6px; }
.gk-plugin-seal .seal-desc { font-size: 11px; font-style: italic; opacity: .7; align-self: center; max-width: 240px; }
.gk-plugin-seal .seal-band { display: flex; flex-direction: column; gap: 2px; padding: 0 6px; border-left: 1px solid rgba(255,255,255,.08); }
.gk-plugin-seal .seal-band:first-child { border-left: 0; }
.gk-plugin-seal .seal-band-title { font-size: 10px; letter-spacing: .2em; opacity: .6; text-transform: uppercase; }
.gk-plugin-seal .seal-band-knobs { display: flex; gap: 4px; flex-wrap: wrap; }
.gk-plugin-seal .seal-readout { font-family: monospace; font-size: 11px; opacity: .85; white-space: pre; align-self: center; }
`;
  document.head.appendChild(st);
}

export function create(ctx, saved) {
  const state = { ...DEFAULTS };
  const nyq = ctx.sampleRate * 0.45;
  const fq = f => clamp(f, 10, nyq);

  const input = ctx.createGain();
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const output = ctx.createGain();
  const bypassGain = ctx.createGain();
  const procOut = ctx.createGain();
  input.connect(bypassGain); bypassGain.connect(output);

  const bq = (type, f, q = BUTTER_Q_DB) => { // q in dB for lowpass/highpass, linear for peaking/allpass
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = fq(f); b.Q.value = q;
    return b;
  };
  const gainNode = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  // --- Trim + EQ ---
  const inTrim = gainNode();
  const ls = bq('lowshelf', 90);
  const lm = bq('peaking', 300, 0.9);
  const hm = bq('peaking', 3500, 0.9);
  const hs = bq('highshelf', 10000);
  input.connect(inTrim); inTrim.connect(ls); ls.connect(lm); lm.connect(hm); hm.connect(hs);

  // --- 3-band LR4 crossover ---
  const lpA = bq('lowpass', 160), lpB = bq('lowpass', 160);
  const apLow = bq('allpass', 3200, Math.SQRT1_2); // phase-match the low band to the upper split (allpass Q is linear)
  const hpA = bq('highpass', 160), hpB = bq('highpass', 160);
  const mlA = bq('lowpass', 3200), mlB = bq('lowpass', 3200);
  const hhA = bq('highpass', 3200), hhB = bq('highpass', 3200);
  hs.connect(lpA); lpA.connect(lpB); lpB.connect(apLow);
  hs.connect(hpA); hpA.connect(hpB);
  hpB.connect(mlA); mlA.connect(mlB);
  hpB.connect(hhA); hhA.connect(hhB);
  const bandSources = [apLow, mlB, hhB];

  // --- Per band: comp -> gain -> M/S width ---
  const mbSum = gainNode();
  const bands = BANDS.map((b, i) => {
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = BAND_KNEE; comp.attack.value = b.attack; comp.release.value = b.release;
    const trim = gainNode();
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const w = { LL: gainNode(), LR: gainNode(0), RL: gainNode(0), RR: gainNode() };
    bandSources[i].connect(comp); comp.connect(trim); trim.connect(split);
    split.connect(w.LL, 0); w.LL.connect(merge, 0, 0);
    split.connect(w.LR, 0); w.LR.connect(merge, 0, 1);
    split.connect(w.RL, 1); w.RL.connect(merge, 0, 0);
    split.connect(w.RR, 1); w.RR.connect(merge, 0, 1);
    merge.connect(mbSum);
    return { ...b, comp, trim, split, merge, w };
  });

  // --- Mono bass: M/S, side high-passed when enabled ---
  const msSplit = ctx.createChannelSplitter(2);
  const mid = gainNode(), side = gainNode();
  const mL = gainNode(0.5), mR = gainNode(0.5), sL = gainNode(0.5), sR = gainNode(-0.5);
  mbSum.connect(msSplit);
  msSplit.connect(mL, 0); mL.connect(mid);
  msSplit.connect(mR, 1); mR.connect(mid);
  msSplit.connect(sL, 0); sL.connect(side);
  msSplit.connect(sR, 1); sR.connect(side);
  const sDirect = gainNode(), sFiltered = gainNode(0);
  const sHP1 = bq('highpass', 120), sHP2 = bq('highpass', 120);
  side.connect(sDirect);
  side.connect(sHP1); sHP1.connect(sHP2); sHP2.connect(sFiltered);
  const sideOut = gainNode();
  sDirect.connect(sideOut); sFiltered.connect(sideOut);
  const msMerge = ctx.createChannelMerger(2);
  const mToL = gainNode(1), mToR = gainNode(1), sToL = gainNode(1), sToR = gainNode(-1);
  mid.connect(mToL); mToL.connect(msMerge, 0, 0);
  mid.connect(mToR); mToR.connect(msMerge, 0, 1);
  sideOut.connect(sToL); sToL.connect(msMerge, 0, 0);
  sideOut.connect(sToR); sToR.connect(msMerge, 0, 1);

  // --- Exciter / saturation ---
  const exDry = gainNode(1), exWet = gainNode(0), exOut = gainNode();
  const exShape = ctx.createWaveShaper(); exShape.oversample = '4x';
  const exGloss = bq('highshelf', 6000); exGloss.gain.value = 3;
  msMerge.connect(exDry); exDry.connect(exOut);
  msMerge.connect(exShape); exShape.connect(exGloss); exGloss.connect(exWet); exWet.connect(exOut);

  // --- Maximizer ---
  const maxGain = gainNode();
  const lim = ctx.createDynamicsCompressor();
  lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001;
  const limTrim = gainNode();
  const clip = ctx.createWaveShaper(); clip.oversample = '4x';
  exOut.connect(maxGain); maxGain.connect(lim); lim.connect(limTrim); limTrim.connect(clip);
  clip.connect(procOut); procOut.connect(output);

  const P = (param, v, imm, tc = 0.02) => {
    if (imm) param.value = v; else param.setTargetAtTime(v, ctx.currentTime, tc);
  };

  function applyBand(i, imm) {
    const b = bands[i], k = b.key;
    const thr = clamp(state[k + 'Thr'], -48, 0), ratio = clamp(state[k + 'Ratio'], 1, 10);
    P(b.comp.threshold, thr, imm);
    P(b.comp.ratio, ratio, imm);
    P(b.trim.gain, dB(clamp(state[k + 'Gain'], -12, 12) - compMakeupDb(thr, ratio, BAND_KNEE)), imm);
  }
  function applyWidth(i, imm) {
    const b = bands[i];
    const w = clamp(state[b.key + 'Width'], 0, 2), a = 0.5 * (1 + w), c = 0.5 * (1 - w);
    P(b.w.LL.gain, a, imm); P(b.w.RR.gain, a, imm); P(b.w.LR.gain, c, imm); P(b.w.RL.gain, c, imm);
  }

  function apply(key, imm) {
    const s = state;
    switch (key) {
      case 'bypass':
        P(procOut.gain, s.bypass ? 0 : 1, imm, 0.01);
        P(bypassGain.gain, s.bypass ? 1 : 0, imm, 0.01);
        break;
      case 'inGain': P(inTrim.gain, dB(s.inGain), imm); break;
      case 'lsFreq': P(ls.frequency, fq(s.lsFreq), imm); break;
      case 'lsGain': P(ls.gain, s.lsGain, imm); break;
      case 'lmFreq': P(lm.frequency, fq(s.lmFreq), imm); break;
      case 'lmGain': P(lm.gain, s.lmGain, imm); break;
      case 'lmQ': P(lm.Q, s.lmQ, imm); break;
      case 'hmFreq': P(hm.frequency, fq(s.hmFreq), imm); break;
      case 'hmGain': P(hm.gain, s.hmGain, imm); break;
      case 'hmQ': P(hm.Q, s.hmQ, imm); break;
      case 'hsFreq': P(hs.frequency, fq(s.hsFreq), imm); break;
      case 'hsGain': P(hs.gain, s.hsGain, imm); break;
      case 'xLow': for (const n of [lpA, lpB, hpA, hpB]) P(n.frequency, fq(s.xLow), imm); break;
      case 'xHigh': for (const n of [apLow, mlA, mlB, hhA, hhB]) P(n.frequency, fq(s.xHigh), imm); break;
      case 'lowThr': case 'lowRatio': case 'lowGain': applyBand(0, imm); break;
      case 'midThr': case 'midRatio': case 'midGain': applyBand(1, imm); break;
      case 'highThr': case 'highRatio': case 'highGain': applyBand(2, imm); break;
      case 'lowWidth': applyWidth(0, imm); break;
      case 'midWidth': applyWidth(1, imm); break;
      case 'highWidth': applyWidth(2, imm); break;
      case 'monoBass':
        P(sDirect.gain, s.monoBass ? 0 : 1, imm, 0.01);
        P(sFiltered.gain, s.monoBass ? 1 : 0, imm, 0.01);
        break;
      case 'monoFreq': P(sHP1.frequency, fq(s.monoFreq), imm); P(sHP2.frequency, fq(s.monoFreq), imm); break;
      case 'exDrive': exShape.curve = satCurve(s.exDrive); break;
      case 'exMix': {
        const m = clamp(s.exMix, 0, 1);
        P(exDry.gain, 1 - m, imm); P(exWet.gain, m, imm);
        break;
      }
      case 'maxIn': P(maxGain.gain, dB(s.maxIn), imm); break;
      case 'ceiling': {
        const c = clamp(s.ceiling, -6, 0);
        P(lim.threshold, c, imm);
        P(limTrim.gain, dB(-compMakeupDb(c, 20)), imm);
        clip.curve = clipCurve(c);
        break;
      }
      case 'release': P(lim.release, clamp(s.release, 0.01, 1), imm); break;
    }
  }

  function coerce(key, v) {
    if (key === 'bypass' || key === 'monoBass') return !!v;
    if (key === 'preset') return typeof v === 'string' ? v : state.preset;
    const n = Number(v);
    if (!Number.isFinite(n)) return state[key];
    const sp = SPEC[key];
    return sp ? clamp(n, sp[0], sp[1]) : n;
  }

  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (k in saved) state[k] = coerce(k, saved[k]);
  }
  for (const k of Object.keys(DEFAULTS)) apply(k, true);

  // ---------------- UI ----------------
  let ui = null;
  let uiCleanup = null;
  const syncUI = key => { if (ui && ui[key]) ui[key].set(state[key]); };

  function loadPreset(name) {
    const p = PRESETS.find(x => x.name === name);
    if (!p) return;
    const next = {};
    for (const k of Object.keys(DEFAULTS)) next[k] = DEFAULTS[k];
    Object.assign(next, p.params, { preset: p.name, bypass: state.bypass });
    api.setState(next);
    if (ui && ui.presetDesc) ui.presetDesc.textContent = p.description;
  }

  const api = {
    id: meta.id, name: meta.name, kind: 'fx',
    input, output,
    getState: () => ({ ...state }),
    setState(obj) {
      if (!obj || typeof obj !== 'object') return;
      const changed = [];
      for (const k of Object.keys(DEFAULTS)) {
        if (!(k in obj)) continue;
        const v = coerce(k, obj[k]);
        if (v === state[k]) continue;
        state[k] = v;
        changed.push(k);
      }
      for (const k of changed) { apply(k, false); syncUI(k); }
    },
    set(key, value) {
      if (!(key in DEFAULTS)) return;
      if (key === 'preset') { loadPreset(String(value)); return; }
      state[key] = coerce(key, value);
      apply(key, false);
      syncUI(key);
    },
    loadPreset,
    renderUI(container) {
      if (uiCleanup) uiCleanup();
      ensureStyle();
      const root = el('div', 'gk-plugin-seal seal-root');
      container.appendChild(root);
      root.appendChild(el('div', 'seal-sigil', '✦ SEAL ✦'));
      ui = {};
      const pct = x => Math.round(x * 100) + '%';
      const hz = x => (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x)) + ' Hz';
      const db = x => (x > 0 ? '+' : '') + x.toFixed(1) + ' dB';
      const ratio = x => x.toFixed(1) + ':1';
      const K = (row, key, label, format, step = 0) => {
        const [min, max] = SPEC[key];
        ui[key] = knob(row, { label, min, max, step, value: state[key], def: DEFAULTS[key], format, size: 40,
          onChange: v => api.set(key, v) });
      };

      const top = section(root, 'Preset');
      ui.preset = select(top, { label: 'Preset', options: PRESETS.map(p => p.name), value: state.preset,
        onChange: v => loadPreset(v) });
      ui.bypass = toggle(top, { label: 'Bypass', value: state.bypass, onChange: v => api.set('bypass', v) });
      const cur = PRESETS.find(p => p.name === state.preset);
      ui.presetDesc = el('div', 'seal-desc', cur ? cur.description : '');
      top.appendChild(ui.presetDesc);

      const eq = section(root, 'Equalizer');
      K(eq, 'inGain', 'Input', db);
      K(eq, 'lsFreq', 'Low shelf', hz); K(eq, 'lsGain', 'LS gain', db);
      K(eq, 'lmFreq', 'Low-mid', hz); K(eq, 'lmGain', 'LM gain', db); K(eq, 'lmQ', 'LM Q', x => x.toFixed(2));
      K(eq, 'hmFreq', 'High-mid', hz); K(eq, 'hmGain', 'HM gain', db); K(eq, 'hmQ', 'HM Q', x => x.toFixed(2));
      K(eq, 'hsFreq', 'High shelf', hz); K(eq, 'hsGain', 'HS gain', db);

      const dyn = section(root, 'Dynamics (3 bands)');
      K(dyn, 'xLow', 'X low', hz); K(dyn, 'xHigh', 'X high', hz);
      for (const b of BANDS) {
        const col = el('div', 'seal-band');
        col.appendChild(el('div', 'seal-band-title', b.key));
        const kn = el('div', 'seal-band-knobs');
        col.appendChild(kn);
        dyn.appendChild(col);
        K(kn, b.key + 'Thr', 'Thresh', x => Math.round(x) + ' dB');
        K(kn, b.key + 'Ratio', 'Ratio', ratio);
        K(kn, b.key + 'Gain', 'Gain', db);
      }

      const img = section(root, 'Imager');
      K(img, 'lowWidth', 'Low width', pct);
      K(img, 'midWidth', 'Mid width', pct);
      K(img, 'highWidth', 'High width', pct);
      ui.monoBass = toggle(img, { label: 'Mono bass', value: state.monoBass, onChange: v => api.set('monoBass', v) });
      K(img, 'monoFreq', 'Mono below', hz);

      const ex = section(root, 'Exciter');
      K(ex, 'exDrive', 'Drive', pct);
      K(ex, 'exMix', 'Mix', pct);

      const mx = section(root, 'Maximizer');
      K(mx, 'maxIn', 'Push', x => '+' + x.toFixed(1) + ' dB');
      K(mx, 'ceiling', 'Ceiling', x => x.toFixed(1) + ' dB');
      K(mx, 'release', 'Release', x => Math.round(x * 1000) + ' ms');

      // Meters: created here only (never in create), torn down when the window goes away.
      const mt = section(root, 'Meters');
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      const mSplit = ctx.createChannelSplitter(2);
      const anL = ctx.createAnalyser(), anR = ctx.createAnalyser();
      anL.fftSize = 1024; anR.fftSize = 1024;
      output.connect(an); output.connect(mSplit);
      mSplit.connect(anL, 0); mSplit.connect(anR, 1);
      const stopMeter = meter(mt, an, { width: 160, height: 10 });
      const readout = el('div', 'seal-readout', '');
      mt.appendChild(readout);
      const bufL = new Float32Array(anL.fftSize), bufR = new Float32Array(anR.fftSize);
      let raf = 0, seen = false, corrS = 1, widthS = 0, frame = 0;
      const red = node => {
        const r = node.reduction;
        return typeof r === 'number' ? r : (r && typeof r.value === 'number' ? r.value : 0);
      };
      function cleanup() {
        cancelAnimationFrame(raf);
        stopMeter();
        try { output.disconnect(an); } catch (e) { /* noop */ }
        try { output.disconnect(mSplit); } catch (e) { /* noop */ }
        try { mSplit.disconnect(); } catch (e) { /* noop */ }
        uiCleanup = null;
      }
      function tick() {
        if (root.isConnected) seen = true;
        else if (seen) { cleanup(); return; }
        anL.getFloatTimeDomainData(bufL);
        anR.getFloatTimeDomainData(bufR);
        let lr = 0, ll = 0, rr = 0, mm = 0, ss = 0;
        for (let i = 0; i < bufL.length; i++) {
          const l = bufL[i], r = bufR[i];
          lr += l * r; ll += l * l; rr += r * r;
          const m = l + r, s = l - r;
          mm += m * m; ss += s * s;
        }
        const corr = ll > 1e-9 && rr > 1e-9 ? lr / Math.sqrt(ll * rr) : 1;
        const width = mm > 1e-9 ? Math.sqrt(ss / mm) : 0;
        corrS += (corr - corrS) * 0.15;
        widthS += (width - widthS) * 0.15;
        if ((frame++ & 3) === 0) {
          readout.textContent =
            `corr ${corrS >= 0 ? '+' : ''}${corrS.toFixed(2)}  width ${Math.round(widthS * 100)}%\n` +
            `GR  lo ${red(bands[0].comp).toFixed(1)}  mid ${red(bands[1].comp).toFixed(1)}  ` +
            `hi ${red(bands[2].comp).toFixed(1)}  max ${red(lim).toFixed(1)} dB`;
        }
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
      uiCleanup = cleanup;
    },
    dispose() {
      if (uiCleanup) uiCleanup();
      const nodes = [input, output, bypassGain, procOut, inTrim, ls, lm, hm, hs, lpA, lpB, apLow, hpA, hpB,
        mlA, mlB, hhA, hhB, mbSum, msSplit, mid, side, mL, mR, sL, sR, sDirect, sFiltered, sHP1, sHP2, sideOut,
        msMerge, mToL, mToR, sToL, sToR, exDry, exWet, exOut, exShape, exGloss, maxGain, lim, limTrim, clip];
      for (const b of bands) nodes.push(b.comp, b.trim, b.split, b.merge, ...Object.values(b.w));
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* noop */ } }
      ui = null;
    },
  };
  return api;
}
