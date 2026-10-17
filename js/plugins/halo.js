// Halo -- one knob that makes a mix read better everywhere. GRIMOIRE 9990.
//
// Why not just a bass + treble boost?
//  - A low shelf adds energy below ~100 Hz that phone and laptop speakers cannot
//    reproduce. It eats headroom and the bass still disappears. Halo instead uses
//    psychoacoustic bass (the MaxxBass idea): it isolates 40-120 Hz, saturates it to
//    create harmonics, keeps only those harmonics (100-300 Hz) and mixes a little
//    back in. The ear infers the missing fundamental from its harmonics, so the
//    bass "reads" on small speakers. Only a gentle shelf is added on top.
//  - Muddiness usually lives around 250-400 Hz. Cutting there broadly and adding a
//    small lift near 3 kHz (presence) improves clarity more than boosting highs.
//  - A treble shelf boosts hiss as much as detail. An Aphex-style exciter takes
//    only the content above ~4.5 kHz, saturates it, and blends a small amount back:
//    it adds new, related upper harmonics (crispness) rather than raising noise.
//    A small 11 kHz shelf adds air on top.
//  - Parallel, low-ratio compression glues the result without squashing transients.
//  - Finally the output is turned down roughly as much as the chain adds, so
//    turning the knob up sounds better rather than just louder (louder always
//    "wins" a careless A/B).
// Everything scales from one "amount" knob (0..100).

import { knob, select, toggle, section, el } from '../ui/widgets.js';

export const meta = {
  id: 'halo',
  name: 'Halo',
  kind: 'fx',
  description: 'One-knob enhancer: psychoacoustic bass, clarity, exciter air and glue, loudness-matched.',
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Web Audio reads Q of lowpass/highpass biquads in dB: Butterworth (linear 0.7071) is -3.01 dB.
const BUTTER_Q_DB = -3.0103;
const dB = d => Math.pow(10, d / 20);

// Per-flavor weights for bass / clarity / air.
export const FLAVORS = {
  balanced: { label: 'Balanced', bass: 1, clar: 1, air: 1 },
  warm: { label: 'Warm', bass: 1.25, clar: 0.9, air: 0.7 },
  bright: { label: 'Bright', bass: 0.8, clar: 1.1, air: 1.3 },
  phone: { label: 'Small speakers', bass: 1.5, clar: 1.15, air: 0.9 },
};

const DEFAULTS = { amount: 35, bypass: false, flavor: 'balanced' };

// Chromium/Firefox DynamicsCompressor adds automatic makeup gain:
// makeup = (1 / gainAt0dBFS) ^ 0.6, i.e. -0.6 * thr * (1 - 1/ratio) dB for a hard knee.
// Measured in Chrome: a soft knee behaves like a threshold raised by knee/2.
const compMakeupDb = (thr, ratio, knee = 0) => -0.6 * Math.min(0, thr + knee / 2) * (1 - 1 / Math.max(1, ratio));

// Bass harmonic generator: hard-driven tanh plus a squared term for even harmonics.
// The DC this creates is removed by the band-pass that follows.
function bassCurve() {
  const n = 2049, c = new Float32Array(n), k = 10, nk = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const t = Math.tanh(k * (i / (n - 1) * 2 - 1)) / nk;
    c[i] = 0.8 * t + 0.4 * t * t;
  }
  return c;
}
function exciterCurve() {
  const n = 2049, c = new Float32Array(n), k = 6, nk = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / nk;
  return c;
}

const STYLE_ID = 'gk-style-halo';
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.gk-plugin-halo .halo-stage { display: flex; flex-direction: column; align-items: center; padding: 10px 18px 4px; }
.gk-plugin-halo .halo-ring { padding: 6px; }
.gk-plugin-halo .halo-ring svg { border-radius: 50%; box-shadow: 0 0 0 1px rgba(255,214,120,.25), 0 0 32px rgba(255,214,120,.22); }
.gk-plugin-halo .halo-ring .gk-knob .gk-label { font-size: 13px; letter-spacing: .25em; }
.gk-plugin-halo .halo-ring .gk-knob .gk-value { font-size: 16px; }
.gk-plugin-halo .halo-title { letter-spacing: .5em; font-size: 12px; opacity: .7; margin-bottom: 8px; }
.gk-plugin-halo .halo-desc { font-size: 11px; opacity: .65; text-align: center; min-height: 1.3em; margin-top: 6px; }
.gk-plugin-halo .halo-row { justify-content: center; }
`;
  document.head.appendChild(st);
}

export function create(ctx, saved) {
  const state = { ...DEFAULTS };
  const nyq = ctx.sampleRate * 0.45;

  const input = ctx.createGain();
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const output = ctx.createGain();
  const bypassDry = ctx.createGain();
  const wetGate = ctx.createGain();
  input.connect(bypassDry); bypassDry.connect(output);

  const bq = (type, f, q = BUTTER_Q_DB, g = 0) => { // q in dB for lowpass/highpass, linear for peaking
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = Math.min(f, nyq); b.Q.value = q; b.gain.value = g;
    return b;
  };
  const sum = ctx.createGain();

  // 1) Tonal path: gentle low shelf, mud cut, presence, air shelf.
  const lowShelf = bq('lowshelf', 90);
  const mud = bq('peaking', 320, 0.8);
  const presence = bq('peaking', 3200, 0.9);
  const air = bq('highshelf', 11000);
  input.connect(lowShelf); lowShelf.connect(mud); mud.connect(presence); presence.connect(air); air.connect(sum);

  // 2) Psychoacoustic bass: isolate 40-120 Hz -> harmonics -> keep 100-300 Hz.
  const bHP = bq('highpass', 40);
  const bLP1 = bq('lowpass', 120), bLP2 = bq('lowpass', 120);
  const bShape = ctx.createWaveShaper(); bShape.curve = bassCurve(); bShape.oversample = '4x'; // 4x measured latency-free in Chrome; 2x is not
  const hHP1 = bq('highpass', 100), hHP2 = bq('highpass', 100);
  const hLP1 = bq('lowpass', 300), hLP2 = bq('lowpass', 300);
  const harmGain = ctx.createGain(); harmGain.gain.value = 0;
  input.connect(bHP); bHP.connect(bLP1); bLP1.connect(bLP2); bLP2.connect(bShape);
  bShape.connect(hHP1); hHP1.connect(hHP2); hHP2.connect(hLP1); hLP1.connect(hLP2); hLP2.connect(harmGain);
  harmGain.connect(sum);

  // 3) Exciter: content above ~4.5 kHz, saturated, cleaned of low IMD, blended in.
  const xHP1 = bq('highpass', 4500), xHP2 = bq('highpass', 4500);
  const xShape = ctx.createWaveShaper(); xShape.curve = exciterCurve(); xShape.oversample = '4x';
  const xHP3 = bq('highpass', 3000);
  const exGain = ctx.createGain(); exGain.gain.value = 0;
  input.connect(xHP1); xHP1.connect(xHP2); xHP2.connect(xShape); xShape.connect(xHP3); xHP3.connect(exGain);
  exGain.connect(sum);

  // 4) Parallel glue compression. DynamicsCompressor has a fixed 6 ms lookahead
  //    (measured), so the dry branch is delayed 6 ms too; otherwise the blend comb-filters.
  const GLUE_THR = -22, GLUE_RATIO = 2, GLUE_KNEE = 10;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = GLUE_THR; glue.ratio.value = GLUE_RATIO; glue.knee.value = GLUE_KNEE;
  glue.attack.value = 0.015; glue.release.value = 0.2;
  const glueWet = ctx.createGain(); glueWet.gain.value = 0;
  const post = ctx.createGain();
  const glueAlign = ctx.createDelay(0.05); glueAlign.delayTime.value = 0.006;
  sum.connect(glueAlign); glueAlign.connect(post);
  sum.connect(glue); glue.connect(glueWet); glueWet.connect(post);

  // 5) Loudness compensation, then bypass crossfade.
  const makeup = ctx.createGain();
  post.connect(makeup); makeup.connect(wetGate); wetGate.connect(output);

  const P = (param, v, imm, tc = 0.03) => {
    if (imm) param.value = v; else param.setTargetAtTime(v, ctx.currentTime, tc);
  };

  function applyAmount(imm) {
    const a = clamp(state.amount, 0, 100) / 100;
    const fl = FLAVORS[state.flavor] || FLAVORS.balanced;
    P(lowShelf.gain, 2.0 * a * fl.bass, imm);
    P(harmGain.gain, 0.12 * a * fl.bass, imm);
    P(mud.gain, -2.5 * a * fl.clar, imm);
    P(presence.gain, 2.0 * a * fl.clar, imm);
    P(air.gain, 2.5 * a * fl.air, imm);
    P(exGain.gain, 0.035 * a * fl.air, imm);
    P(glueWet.gain, 0.35 * a * dB(-compMakeupDb(GLUE_THR, GLUE_RATIO, GLUE_KNEE)), imm);
    // Rough loudness match: the chain adds ~3 dB of perceived level at full amount.
    const weight = (fl.bass * 0.8 + fl.clar * 0.6 + fl.air * 0.6) / 2;
    P(makeup.gain, dB(-(1.6 + 1.4 * weight) * Math.pow(a, 0.9)), imm);
  }
  function applyBypass(imm) {
    P(wetGate.gain, state.bypass ? 0 : 1, imm, 0.01);
    P(bypassDry.gain, state.bypass ? 1 : 0, imm, 0.01);
  }

  function coerce(key, v) {
    if (key === 'bypass') return !!v;
    if (key === 'flavor') return FLAVORS[v] ? v : state.flavor;
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, 0, 100) : state.amount;
  }

  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (k in saved) state[k] = coerce(k, saved[k]);
  }
  applyAmount(true);
  applyBypass(true);

  let ui = null;
  function describe() {
    if (!ui || !ui.desc) return;
    const a = state.amount;
    ui.desc.textContent = state.bypass ? 'bypassed'
      : a < 1 ? 'resting'
      : a < 30 ? 'a faint glow'
      : a < 60 ? 'bass harmonics, clarity, air'
      : a < 85 ? 'full halo'
      : 'radiant (check your mix)';
  }
  function syncUI(key) {
    if (ui && ui[key]) ui[key].set(state[key]);
    describe();
  }

  const api = {
    id: meta.id, name: meta.name, kind: 'fx',
    input, output,
    getState: () => ({ ...state }),
    setState(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(DEFAULTS)) if (k in obj) { state[k] = coerce(k, obj[k]); syncUI(k); }
      applyAmount(false);
      applyBypass(false);
    },
    set(key, value) {
      if (!(key in DEFAULTS)) return;
      state[key] = coerce(key, value);
      if (key === 'bypass') applyBypass(false); else applyAmount(false);
      syncUI(key);
    },
    renderUI(container) {
      ensureStyle();
      const root = el('div', 'gk-plugin-halo halo-root');
      container.appendChild(root);
      ui = {};
      const stage = el('div', 'halo-stage');
      root.appendChild(stage);
      stage.appendChild(el('div', 'halo-title', '☉ HALO ☉'));
      const ring = el('div', 'halo-ring');
      stage.appendChild(ring);
      ui.amount = knob(ring, {
        label: 'AMOUNT', min: 0, max: 100, step: 1, value: state.amount, def: DEFAULTS.amount, size: 150,
        format: x => Math.round(x) + '%', onChange: v => api.set('amount', v),
      });
      ui.desc = el('div', 'halo-desc');
      stage.appendChild(ui.desc);
      const row = section(root, null);
      row.classList.add('halo-row');
      ui.bypass = toggle(row, { label: 'Bypass', value: state.bypass, onChange: v => api.set('bypass', v) });
      ui.flavor = select(row, {
        label: 'Flavor',
        options: Object.entries(FLAVORS).map(([value, f]) => ({ label: f.label, value })),
        value: state.flavor, onChange: v => api.set('flavor', v),
      });
      describe();
    },
    dispose() {
      const nodes = [input, output, bypassDry, wetGate, sum, lowShelf, mud, presence, air, bHP, bLP1, bLP2, bShape,
        hHP1, hHP2, hLP1, hLP2, harmGain, xHP1, xHP2, xShape, xHP3, exGain, glue, glueWet, glueAlign, post, makeup];
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* noop */ } }
      ui = null;
    },
  };
  return api;
}
