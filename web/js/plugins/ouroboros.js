// Ouroboros -- the serpent that eats its own tail. A feedback delay for GRIMOIRE 9990.
//
// Two delay lines (L, R). Each loop runs: delay -> low cut -> high cut -> tape head
// lowpass -> soft saturation -> back into the delays through a 2x2 feedback matrix.
// The mode (stereo / ping-pong / mono / tape) only changes three 2x2 gain matrices
// (input -> delays, feedback routing, delays -> outputs), so switching modes glides
// instead of clicking. Width is folded into the output matrix as M/S scaling.
// Loop stability: the saturator has unity small-signal gain and only compresses,
// filters never exceed unity, and feedback is capped at 0.95.

import { knob, select, section, el } from '../ui/widgets.js';

export const meta = {
  id: 'ouroboros',
  name: 'Ouroboros',
  kind: 'fx',
  description: 'Feedback delay: stereo, ping-pong, mono and tape, tempo-synced, with saturation in the loop.',
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Web Audio reads Q of lowpass/highpass biquads in dB: Butterworth (linear 0.7071) is -3.01 dB.
const BUTTER_Q_DB = -3.0103;

// Length of each division in quarter-note beats.
export const DIVISIONS = {
  '1/1': 4, '1/2': 2, '1/2D': 3, '1/2T': 4 / 3,
  '1/4': 1, '1/4D': 1.5, '1/4T': 2 / 3,
  '1/8': 0.5, '1/8D': 0.75, '1/8T': 1 / 3,
  '1/16': 0.25, '1/16D': 0.375, '1/16T': 1 / 6,
  '1/32': 0.125,
};
const MODES = ['stereo', 'pingpong', 'mono', 'tape'];
const MODE_LABELS = { stereo: 'Stereo', pingpong: 'Ping-pong', mono: 'Mono', tape: 'Tape' };

const DEFAULTS = {
  mode: 'pingpong',
  sync: '1/8D',      // a key of DIVISIONS, or 'free'
  time: 375,         // ms, used when sync === 'free'
  feedback: 0.45,    // 0..0.95
  lowcut: 120,       // Hz, in the feedback path
  highcut: 6500,     // Hz, in the feedback path
  drive: 0.25,       // 0..1 loop saturation
  wow: 0.1,          // 0..1 wow/flutter depth (doubled feel in tape mode)
  width: 1,          // 0..2
  mix: 0.3,          // 0..1 equal-power
};

const MIN_DELAY = 0.02, MAX_DELAY = 3.9;

// Matrices as { LL, LR, RL, RR } meaning source -> destination.
const ROUTES = {
  stereo:   { A: { LL: 1, LR: 0, RL: 0, RR: 1 },       F: { LL: 1, LR: 0, RL: 0, RR: 1 }, O: { LL: 1, LR: 0, RL: 0, RR: 1 } },
  pingpong: { A: { LL: 0.5, LR: 0, RL: 0.5, RR: 0 },   F: { LL: 0, LR: 1, RL: 1, RR: 0 }, O: { LL: 1, LR: 0, RL: 0, RR: 1 } },
  mono:     { A: { LL: 0.5, LR: 0, RL: 0.5, RR: 0 },   F: { LL: 1, LR: 0, RL: 0, RR: 0 }, O: { LL: 1, LR: 1, RL: 0, RR: 0 } },
  tape:     { A: { LL: 0.5, LR: 0.5, RL: 0.5, RR: 0.5 }, F: { LL: 1, LR: 0, RL: 0, RR: 1 }, O: { LL: 1, LR: 0, RL: 0, RR: 1 } },
};

// y = tanh(k x) / k : unity gain for small signals, compresses loud repeats.
function satCurve(k) {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    c[i] = Math.tanh(k * x) / k;
  }
  return c;
}

const STYLE_ID = 'gk-style-ouroboros';
function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.gk-plugin-ouroboros .ouro-time { font-variant-numeric: tabular-nums; min-width: 90px; align-self: center; opacity: .8; font-size: 12px; }
.gk-plugin-ouroboros .ouro-sigil { font-size: 11px; letter-spacing: .3em; opacity: .55; text-align: center; margin: 2px 0 6px; }
`;
  document.head.appendChild(st);
}

export function create(ctx, saved) {
  const state = { ...DEFAULTS };
  let bpm = 120;
  const nyq = ctx.sampleRate * 0.45;

  const input = ctx.createGain();
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const output = ctx.createGain();
  const dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output);

  const inSplit = ctx.createChannelSplitter(2);
  input.connect(inSplit);
  const dL = ctx.createDelay(4), dR = ctx.createDelay(4);
  dL.delayTime.value = 0.375; dR.delayTime.value = 0.375;

  const gain = () => ctx.createGain();
  const A = { LL: gain(), LR: gain(), RL: gain(), RR: gain() };
  const F = { LL: gain(), LR: gain(), RL: gain(), RR: gain() };
  const O = { LL: gain(), LR: gain(), RL: gain(), RR: gain() };

  inSplit.connect(A.LL, 0); A.LL.connect(dL);
  inSplit.connect(A.LR, 0); A.LR.connect(dR);
  inSplit.connect(A.RL, 1); A.RL.connect(dL);
  inSplit.connect(A.RR, 1); A.RR.connect(dR);

  function loopChain(delay) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = BUTTER_Q_DB;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = BUTTER_Q_DB;
    const head = ctx.createBiquadFilter(); head.type = 'lowpass'; head.Q.value = -6.02; // linear Q 0.5: soft tape-head rolloff
    const sat = ctx.createWaveShaper(); sat.oversample = '2x';
    delay.connect(hp); hp.connect(lp); lp.connect(head); head.connect(sat);
    return { hp, lp, head, sat };
  }
  const L = loopChain(dL), R = loopChain(dR);

  L.sat.connect(F.LL); F.LL.connect(dL);
  L.sat.connect(F.LR); F.LR.connect(dR);
  R.sat.connect(F.RL); F.RL.connect(dL);
  R.sat.connect(F.RR); F.RR.connect(dR);

  const merge = ctx.createChannelMerger(2);
  L.sat.connect(O.LL); O.LL.connect(merge, 0, 0);
  L.sat.connect(O.LR); O.LR.connect(merge, 0, 1);
  R.sat.connect(O.RL); O.RL.connect(merge, 0, 0);
  R.sat.connect(O.RR); O.RR.connect(merge, 0, 1);
  merge.connect(wet); wet.connect(output);

  // Wow (slow) and flutter (fast) modulate both delay times together.
  const wowOsc = ctx.createOscillator(); wowOsc.frequency.value = 0.55;
  const flutOsc = ctx.createOscillator(); flutOsc.frequency.value = 6.3;
  const wowG = gain(), flutG = gain();
  wowOsc.connect(wowG); flutOsc.connect(flutG);
  wowG.connect(dL.delayTime); wowG.connect(dR.delayTime);
  flutG.connect(dL.delayTime); flutG.connect(dR.delayTime);
  wowOsc.start(); flutOsc.start();

  const P = (param, v, imm, tc = 0.02) => {
    if (imm) param.value = v; else param.setTargetAtTime(v, ctx.currentTime, tc);
  };

  function delaySeconds() {
    if (state.sync !== 'free' && DIVISIONS[state.sync]) return clamp(DIVISIONS[state.sync] * 60 / bpm, MIN_DELAY, MAX_DELAY);
    return clamp(state.time / 1000, MIN_DELAY, MAX_DELAY);
  }

  let timeLabel = null;
  function updateTime(imm) {
    const t = delaySeconds();
    const tR = state.mode === 'tape' ? Math.min(MAX_DELAY, t + 0.007) : t;
    // A gentle glide on time changes: sounds like a tape machine, never a click.
    P(dL.delayTime, t, imm, 0.05);
    P(dR.delayTime, tR, imm, 0.05);
    if (timeLabel) timeLabel.textContent = Math.round(t * 1000) + ' ms';
  }

  function routing(imm) {
    const r = ROUTES[state.mode] || ROUTES.stereo;
    const fb = clamp(state.feedback, 0, 0.95);
    for (const k of ['LL', 'LR', 'RL', 'RR']) {
      P(A[k].gain, r.A[k], imm);
      P(F[k].gain, r.F[k] * fb, imm);
    }
    const w = clamp(state.width, 0, 2), a = 0.5 * (1 + w), b = 0.5 * (1 - w);
    // Fold width W into O: out = O * W
    for (const src of ['L', 'R']) {
      const toL = r.O[src + 'L'] * a + r.O[src + 'R'] * b;
      const toR = r.O[src + 'L'] * b + r.O[src + 'R'] * a;
      P(O[src + 'L'].gain, toL, imm);
      P(O[src + 'R'].gain, toR, imm);
    }
  }

  function applyDrive() {
    const k = 0.3 + 2.2 * clamp(state.drive, 0, 1) + (state.mode === 'tape' ? 0.6 : 0);
    const curve = satCurve(k);
    L.sat.curve = curve; R.sat.curve = curve;
  }

  function apply(key, imm) {
    const s = state;
    switch (key) {
      case 'mode':
        routing(imm); updateTime(imm); applyDrive(); apply('wow', imm);
        P(L.head.frequency, s.mode === 'tape' ? 5200 : nyq, imm);
        P(R.head.frequency, s.mode === 'tape' ? 5200 : nyq, imm);
        break;
      case 'sync': case 'time': updateTime(imm); break;
      case 'feedback': case 'width': routing(imm); break;
      case 'lowcut': {
        const f = clamp(s.lowcut, 20, 2000);
        P(L.hp.frequency, f, imm); P(R.hp.frequency, f, imm); break;
      }
      case 'highcut': {
        const f = clamp(s.highcut, 500, nyq);
        P(L.lp.frequency, f, imm); P(R.lp.frequency, f, imm); break;
      }
      case 'drive': applyDrive(); break;
      case 'wow': {
        const m = clamp(s.wow, 0, 1) * (s.mode === 'tape' ? 1.6 : 1);
        P(wowG.gain, m * 0.004, imm);
        P(flutG.gain, m * 0.00035, imm);
        break;
      }
      case 'mix': {
        const m = clamp(s.mix, 0, 1);
        P(dry.gain, Math.cos(m * Math.PI / 2), imm);
        P(wet.gain, Math.sin(m * Math.PI / 2), imm);
        break;
      }
    }
  }

  function coerce(key, v) {
    if (key === 'mode') return MODES.includes(v) ? v : state.mode;
    if (key === 'sync') return (v === 'free' || DIVISIONS[v]) ? v : state.sync;
    const n = Number(v);
    return Number.isFinite(n) ? n : state[key];
  }

  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (k in saved) state[k] = coerce(k, saved[k]);
  }
  for (const k of Object.keys(DEFAULTS)) apply(k, true);

  let ui = null;
  const syncUI = key => { if (ui && ui[key]) ui[key].set(state[key]); };

  const api = {
    id: meta.id, name: meta.name, kind: 'fx',
    input, output,
    getState: () => ({ ...state }),
    setState(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(DEFAULTS)) {
        if (!(k in obj)) continue;
        state[k] = coerce(k, obj[k]);
        syncUI(k);
      }
      for (const k of Object.keys(DEFAULTS)) apply(k, false);
    },
    set(key, value) {
      if (!(key in DEFAULTS)) return;
      state[key] = coerce(key, value);
      apply(key, false);
      syncUI(key);
    },
    setTempo(newBpm) {
      const b = Number(newBpm);
      if (!Number.isFinite(b) || b <= 0) return;
      bpm = clamp(b, 20, 400);
      updateTime(false);
    },
    renderUI(container) {
      ensureStyle();
      const root = el('div', 'gk-plugin-ouroboros ouro-root');
      container.appendChild(root);
      root.appendChild(el('div', 'ouro-sigil', '∞ OUROBOROS ∞'));
      const pct = x => Math.round(x * 100) + '%';
      const hz = x => (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x)) + ' Hz';
      ui = {};
      const K = (row, key, label, min, max, format, step = 0) => {
        ui[key] = knob(row, { label, min, max, step, value: state[key], def: DEFAULTS[key], format,
          onChange: v => api.set(key, v) });
      };

      const top = section(root, 'Coil');
      ui.mode = select(top, { label: 'Mode', options: MODES.map(m => ({ label: MODE_LABELS[m], value: m })),
        value: state.mode, onChange: v => api.set('mode', v) });
      ui.sync = select(top, { label: 'Sync',
        options: [{ label: 'Free (ms)', value: 'free' }, ...Object.keys(DIVISIONS).map(d => ({ label: d, value: d }))],
        value: state.sync, onChange: v => api.set('sync', v) });
      timeLabel = el('div', 'ouro-time');
      top.appendChild(timeLabel);

      const time = section(root, 'Time');
      K(time, 'time', 'Free time', 20, 2000, x => Math.round(x) + ' ms', 1);
      K(time, 'feedback', 'Feedback', 0, 0.95, pct);
      const tone = section(root, 'Loop tone');
      K(tone, 'lowcut', 'Low cut', 20, 2000, hz);
      K(tone, 'highcut', 'High cut', 500, 20000, hz);
      K(tone, 'drive', 'Drive', 0, 1, pct);
      K(tone, 'wow', 'Wow/flutter', 0, 1, pct);
      const out = section(root, 'Output');
      K(out, 'width', 'Width', 0, 2, pct);
      K(out, 'mix', 'Mix', 0, 1, pct);
      updateTime(false);
    },
    dispose() {
      try { wowOsc.stop(); } catch (e) { /* noop */ }
      try { flutOsc.stop(); } catch (e) { /* noop */ }
      const nodes = [input, output, dry, wet, inSplit, dL, dR, merge, wowOsc, flutOsc, wowG, flutG,
        L.hp, L.lp, L.head, L.sat, R.hp, R.lp, R.head, R.sat,
        ...Object.values(A), ...Object.values(F), ...Object.values(O)];
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* noop */ } }
      ui = null; timeLabel = null;
    },
  };
  return api;
}
