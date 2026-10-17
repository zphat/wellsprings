// Sigil: the grimoire's own polyphonic synth.
//
// Signal path per voice:
//   osc I + osc II (1 or 3 unison) + noise -> filter -> amp ADSR -> tremolo -> bus
//   sub osc (one octave down) ---------------------^  (bypasses the filter)
// Global path:
//   bus -> drive (tanh soft clip) -> makeup -> L direct / R via short Haas delay -> output
//
// Voices are scheduled against ctx time, never against "what is playing now",
// because the engine (and offline WAV export) may schedule a note's on and off
// before an earlier note's on. Every voice records its start / off / end times
// and polyphony, mono choking and glide all reason about those times.

import { mulberry32, pick, range, weighted } from '../audio/rng.js';
import { el, knob, select, toggle, button, section } from '../ui/widgets.js';

export const meta = {
  id: 'sigil',
  name: 'Sigil',
  kind: 'instrument',
  description: 'Polyphonic subtractive synth with a seeded Summon generator',
};

const MAX_VOICES = 24;
const STORE_KEY = 'wellsprings.sigil.presets';
const WAVES = ['sine', 'sawtooth', 'square', 'triangle'];
const FILTERS = ['lowpass', 'bandpass', 'highpass'];
const LFO_TARGETS = ['pitch', 'filter', 'amp'];
export const ARCHETYPES = ['pad', 'pluck', 'bass', 'lead', 'keys', 'bell', 'brass', 'ambient'];

export const DEFAULT_STATE = Object.freeze({
  name: 'Blank Sigil', seed: 9990, archetype: 'keys',
  osc1Wave: 'sawtooth', osc1Semi: 0, osc1Detune: 0, osc1Level: 0.8,
  osc2Wave: 'square', osc2Semi: 0, osc2Detune: 7, osc2Level: 0.4, osc2Unison: false, osc2Spread: 12,
  subLevel: 0, noiseLevel: 0,
  filterType: 'lowpass', cutoff: 2400, resonance: 0.2, envAmount: 0.3, keytrack: 0.5,
  ampA: 0.005, ampD: 0.3, ampS: 0.7, ampR: 0.3,
  fltA: 0.005, fltD: 0.4, fltS: 0.3, fltR: 0.4,
  lfoRate: 5, lfoTarget: 'pitch', lfoDepth: 0,
  glide: 0, mono: false, drive: 0.1, width: 0.3, transpose: 0, gain: 0.8,
});

// [min, max, step] for every numeric parameter. Used for clamping and the UI.
const RANGES = {
  seed: [0, 4294967295, 1],
  osc1Semi: [-24, 24, 1], osc1Detune: [-50, 50, 0], osc1Level: [0, 1, 0],
  osc2Semi: [-24, 36, 1], osc2Detune: [-50, 50, 0], osc2Level: [0, 1, 0], osc2Spread: [0, 50, 0],
  subLevel: [0, 1, 0], noiseLevel: [0, 1, 0],
  cutoff: [30, 18000, 0], resonance: [0, 1, 0], envAmount: [-1, 1, 0], keytrack: [0, 1, 0],
  ampA: [0.001, 6, 0], ampD: [0.01, 8, 0], ampS: [0, 1, 0], ampR: [0.01, 10, 0],
  fltA: [0.001, 6, 0], fltD: [0.01, 8, 0], fltS: [0, 1, 0], fltR: [0.01, 10, 0],
  lfoRate: [0.05, 20, 0], lfoDepth: [0, 1, 0],
  glide: [0, 1, 0], drive: [0, 1, 0], width: [0, 1, 0], transpose: [-24, 24, 1], gain: [0, 1, 0],
};
const ENUMS = { osc1Wave: WAVES, osc2Wave: WAVES, filterType: FILTERS, lfoTarget: LFO_TARGETS, archetype: ARCHETYPES };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// Range clamp only: user edits and presets are respected as long as they are valid.
export function clampState(s) {
  const out = { ...DEFAULT_STATE, ...(s || {}) };
  for (const k in RANGES) {
    const [lo, hi, step] = RANGES[k];
    let v = Number(out[k]);
    if (!Number.isFinite(v)) v = DEFAULT_STATE[k];
    v = clamp(v, lo, hi);
    if (step) v = Math.round(v / step) * step;
    out[k] = v;
  }
  for (const k in ENUMS) if (!ENUMS[k].includes(out[k])) out[k] = DEFAULT_STATE[k];
  out.osc2Unison = !!out.osc2Unison;
  out.mono = !!out.mono;
  out.name = String(out.name || 'Untitled');
  return out;
}

// ---------------------------------------------------------------------------
// Summon: weighted archetypes with correlated, musically sane ranges.

const ARCH_WEIGHTS = [['pad', 16], ['pluck', 16], ['bass', 13], ['lead', 12], ['keys', 13], ['bell', 10], ['brass', 10], ['ambient', 10]];

const EPITHETS = ['Veiled', 'Gilded', 'Lunar', 'Solar', 'Hermetic', 'Quiet', 'Ninth', 'Mercurial', 'Saturnine', 'Jovial',
  'Venusian', 'Starlit', 'Emerald', 'Azure', 'Silver', 'Ember', 'Kind', 'Patient', 'Morning', 'Midnight', 'Sevenfold',
  'Wandering', 'Lucid', 'Woven', 'Sacred', 'Hollow', 'Bright', 'Dreaming', 'Copper', 'Opaline'];
const ARCH_NOUNS = {
  pad: ['Veil', 'Halo', 'Pad', 'Nebula', 'Canticle'], pluck: ['Pluck', 'Spark', 'Seed', 'Quill', 'Rune'],
  bass: ['Bass', 'Root', 'Foundation', 'Anchor', 'Undertone'], lead: ['Lead', 'Herald', 'Voice', 'Flame', 'Messenger'],
  keys: ['Keys', 'Tablet', 'Organum', 'Lectern', 'Chapel'], bell: ['Bell', 'Chime', 'Orrery', 'Tintinnabulum', 'Star'],
  brass: ['Brass', 'Fanfare', 'Horn', 'Procession', 'Herald'], ambient: ['Mist', 'Aether', 'Tide', 'Drift', 'Ether'],
};

function makeTools(rng) {
  return {
    R: (lo, hi) => range(rng, lo, hi),
    LR: (lo, hi) => Math.exp(range(rng, Math.log(lo), Math.log(hi))), // log-uniform, for times and Hz
    P: arr => pick(rng, arr),
    C: p => rng() < p,
  };
}

const GENERATORS = {
  pad({ R, LR, P, C }) {
    const uni = C(0.7);
    return {
      osc1Wave: P(['sawtooth', 'sawtooth', 'sawtooth', 'triangle']), osc1Semi: 0, osc1Detune: R(-6, 0), osc1Level: R(0.5, 0.75),
      osc2Wave: P(['sawtooth', 'sawtooth', 'square', 'triangle']), osc2Semi: P([0, 0, 12, 7, -12]), osc2Detune: R(3, 9),
      osc2Level: R(0.4, 0.65), osc2Unison: uni, osc2Spread: R(8, 20),
      subLevel: C(0.3) ? R(0.05, 0.2) : 0, noiseLevel: C(0.4) ? R(0.01, 0.07) : 0,
      filterType: 'lowpass', cutoff: LR(500, 2200), resonance: R(0.05, 0.35), envAmount: R(0, 0.25), keytrack: R(0.3, 0.6),
      ampA: LR(0.3, 1.8), ampD: R(0.5, 2), ampS: R(0.6, 0.9), ampR: LR(1, 4),
      fltA: LR(0.3, 2), fltD: R(1, 3), fltS: R(0.4, 0.8), fltR: R(1, 3),
      ...(C(0.6) ? { lfoTarget: 'filter', lfoRate: LR(0.1, 0.6), lfoDepth: R(0.1, 0.35) }
        : { lfoTarget: 'pitch', lfoRate: R(4, 5.5), lfoDepth: R(0.05, 0.12) }),
      glide: 0, mono: false, drive: R(0, 0.15), width: R(0.5, 0.9),
    };
  },
  pluck({ R, LR, P, C }) {
    const ampD = LR(0.15, 0.6);
    return {
      osc1Wave: P(['sawtooth', 'square', 'triangle', 'sawtooth']), osc1Semi: 0, osc1Detune: 0, osc1Level: R(0.6, 0.85),
      osc2Wave: P(['sawtooth', 'square', 'sine']), osc2Semi: P([0, 12, 7, 19, -12]), osc2Detune: R(2, 8),
      osc2Level: R(0.2, 0.5), osc2Unison: C(0.2), osc2Spread: R(6, 14),
      subLevel: C(0.25) ? R(0.05, 0.25) : 0, noiseLevel: C(0.3) ? R(0.01, 0.05) : 0,
      filterType: 'lowpass', cutoff: LR(300, 1200), resonance: R(0.1, 0.45), envAmount: R(0.4, 0.85), keytrack: R(0.5, 0.9),
      ampA: R(0.001, 0.004), ampD, ampS: C(0.5) ? 0 : R(0, 0.12), ampR: Math.max(ampD * 0.6, LR(0.1, 0.4)),
      fltA: 0.001, fltD: LR(0.08, 0.4), fltS: R(0, 0.1), fltR: R(0.1, 0.3),
      lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0,
      glide: 0, mono: false, drive: R(0, 0.3), width: R(0.2, 0.6),
    };
  },
  bass({ R, LR, P, C }) {
    const mono = C(0.75), reese = C(0.15);
    return {
      osc1Wave: P(['sawtooth', 'square', 'sawtooth', 'triangle']), osc1Semi: 0, osc1Detune: 0, osc1Level: R(0.55, 0.8),
      osc2Wave: P(['sawtooth', 'square']), osc2Semi: P([0, 0, -12]), osc2Detune: R(5, 15),
      osc2Level: R(0.2, 0.5), osc2Unison: reese, osc2Spread: R(10, 25),
      subLevel: C(0.85) ? R(0.4, 0.8) : 0, noiseLevel: 0,
      filterType: 'lowpass', cutoff: LR(150, 800), resonance: R(0.1, 0.5), envAmount: R(0.2, 0.6), keytrack: R(0.2, 0.5),
      ampA: R(0.001, 0.01), ampD: R(0.2, 0.8), ampS: R(0.5, 0.9), ampR: R(0.05, 0.2),
      fltA: R(0.001, 0.01), fltD: R(0.1, 0.5), fltS: R(0.1, 0.4), fltR: R(0.1, 0.3),
      lfoTarget: 'filter', lfoRate: R(0.5, 3), lfoDepth: reese && C(0.5) ? R(0.05, 0.2) : 0,
      glide: mono && C(0.5) ? LR(0.03, 0.12) : 0, mono, drive: R(0.1, 0.45), width: R(0, 0.1),
    };
  },
  lead({ R, LR, P, C }) {
    const mono = C(0.5);
    return {
      osc1Wave: P(['sawtooth', 'square']), osc1Semi: 0, osc1Detune: 0, osc1Level: R(0.55, 0.8),
      osc2Wave: P(['sawtooth', 'square', 'sawtooth']), osc2Semi: P([0, 0, 12, 7]), osc2Detune: R(5, 12),
      osc2Level: R(0.3, 0.6), osc2Unison: C(0.35), osc2Spread: R(8, 18),
      subLevel: C(0.4) ? R(0.1, 0.3) : 0, noiseLevel: 0,
      filterType: 'lowpass', cutoff: LR(1200, 4000), resonance: R(0.1, 0.4), envAmount: R(0.15, 0.5), keytrack: R(0.5, 0.8),
      ampA: R(0.003, 0.03), ampD: R(0.2, 0.6), ampS: R(0.6, 0.9), ampR: R(0.1, 0.4),
      fltA: R(0.003, 0.02), fltD: R(0.2, 0.6), fltS: R(0.3, 0.6), fltR: R(0.2, 0.4),
      lfoTarget: 'pitch', lfoRate: R(4.5, 6.5), lfoDepth: C(0.7) ? R(0.08, 0.2) : 0,
      glide: mono ? LR(0.02, 0.1) : R(0, 0.04), mono, drive: R(0.1, 0.4), width: R(0.2, 0.5),
    };
  },
  keys({ R, LR, P, C }) {
    const bright = C(0.4);
    return {
      osc1Wave: P(['triangle', 'triangle', 'sine', 'square']), osc1Semi: 0, osc1Detune: 0, osc1Level: R(0.65, 0.85),
      osc2Wave: bright ? 'sawtooth' : 'sine', osc2Semi: bright ? 0 : 12, osc2Detune: R(2, 6),
      osc2Level: R(0.2, 0.5), osc2Unison: false, osc2Spread: 10,
      subLevel: C(0.3) ? R(0.05, 0.2) : 0, noiseLevel: C(0.3) ? R(0.005, 0.02) : 0,
      filterType: 'lowpass', cutoff: LR(1500, 4500), resonance: R(0.05, 0.25), envAmount: R(0.2, 0.5), keytrack: R(0.4, 0.7),
      ampA: R(0.001, 0.008), ampD: LR(0.6, 2.5), ampS: R(0.1, 0.35), ampR: R(0.2, 0.6),
      fltA: 0.002, fltD: R(0.3, 1.2), fltS: R(0.2, 0.4), fltR: R(0.2, 0.5),
      ...(C(0.3) ? { lfoTarget: 'amp', lfoRate: R(3, 6), lfoDepth: R(0.1, 0.3) } : { lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0 }),
      glide: 0, mono: false, drive: R(0.05, 0.25), width: R(0.3, 0.6),
    };
  },
  bell({ R, LR, P, C }) {
    return {
      osc1Wave: C(0.7) ? 'sine' : 'triangle', osc1Semi: 0, osc1Detune: 0, osc1Level: R(0.6, 0.8),
      osc2Wave: P(['sine', 'sine', 'triangle']), osc2Semi: P([12, 19, 24, 28]), osc2Detune: R(0, 8),
      osc2Level: R(0.3, 0.6), osc2Unison: false, osc2Spread: 6,
      subLevel: 0, noiseLevel: 0,
      filterType: 'lowpass', cutoff: LR(2500, 8000), resonance: R(0.05, 0.2), envAmount: R(0.1, 0.3), keytrack: R(0.5, 0.8),
      ampA: R(0.001, 0.004), ampD: LR(1.2, 3.5), ampS: R(0, 0.1), ampR: LR(0.8, 2.5),
      fltA: 0.001, fltD: R(0.5, 2), fltS: R(0, 0.3), fltR: R(0.5, 1.5),
      lfoTarget: 'amp', lfoRate: R(3, 5), lfoDepth: C(0.25) ? R(0.05, 0.15) : 0,
      glide: 0, mono: false, drive: R(0, 0.1), width: R(0.4, 0.8),
    };
  },
  brass({ R, LR, P, C }) {
    return {
      osc1Wave: 'sawtooth', osc1Semi: 0, osc1Detune: R(-3, 0), osc1Level: R(0.6, 0.8),
      osc2Wave: P(['sawtooth', 'sawtooth', 'square']), osc2Semi: P([0, 0, 0, 12]), osc2Detune: R(6, 12),
      osc2Level: R(0.5, 0.8), osc2Unison: C(0.4), osc2Spread: R(6, 14),
      subLevel: C(0.4) ? R(0.05, 0.2) : 0, noiseLevel: C(0.4) ? R(0.01, 0.03) : 0,
      filterType: 'lowpass', cutoff: LR(500, 1200), resonance: R(0.05, 0.25), envAmount: R(0.35, 0.6), keytrack: R(0.5, 0.8),
      ampA: LR(0.02, 0.09), ampD: R(0.3, 0.8), ampS: R(0.7, 0.9), ampR: R(0.15, 0.4),
      fltA: LR(0.04, 0.15), fltD: R(0.3, 0.8), fltS: R(0.3, 0.6), fltR: R(0.2, 0.4),
      lfoTarget: 'pitch', lfoRate: R(4.5, 5.5), lfoDepth: C(0.5) ? R(0.05, 0.1) : 0,
      glide: 0, mono: false, drive: R(0.1, 0.35), width: R(0.3, 0.6),
    };
  },
  ambient({ R, LR, P, C }) {
    const bp = C(0.3);
    return {
      osc1Wave: P(['sine', 'triangle', 'sawtooth']), osc1Semi: 0, osc1Detune: 0, osc1Level: R(0.5, 0.75),
      osc2Wave: P(['sine', 'triangle', 'sawtooth']), osc2Semi: P([7, 12, 19, 24, -12]), osc2Detune: R(3, 10),
      osc2Level: R(0.3, 0.6), osc2Unison: C(0.5), osc2Spread: R(10, 25),
      subLevel: C(0.2) ? R(0.05, 0.15) : 0, noiseLevel: R(0.05, 0.3),
      filterType: bp ? 'bandpass' : 'lowpass', cutoff: LR(400, 2500), resonance: R(0.1, 0.5), envAmount: R(0, 0.2), keytrack: R(0.2, 0.5),
      ampA: LR(0.8, 3.5), ampD: R(1, 3), ampS: R(0.6, 1), ampR: LR(2, 6),
      fltA: LR(0.5, 3), fltD: R(1, 3), fltS: R(0.4, 0.8), fltR: R(1, 3),
      ...(C(0.7) ? { lfoTarget: 'filter', lfoRate: LR(0.05, 0.4), lfoDepth: R(0.2, 0.5) }
        : { lfoTarget: 'amp', lfoRate: R(0.2, 1), lfoDepth: R(0.2, 0.4) }),
      glide: 0, mono: false, drive: R(0, 0.15), width: R(0.6, 1),
    };
  },
};

// Small seeded nudges so two summons of the same archetype never sound like twins.
function mutate(s, rng) {
  const nudge = (k, amt) => { s[k] *= Math.pow(2, range(rng, -amt, amt)); };
  for (const k of ['cutoff', 'ampA', 'ampD', 'ampR', 'fltA', 'fltD', 'fltR', 'lfoRate']) nudge(k, 0.15);
  for (const k of ['osc1Level', 'osc2Level', 'resonance', 'envAmount', 'drive', 'width']) s[k] += range(rng, -0.04, 0.04);
  s.osc2Detune += range(rng, -1.5, 1.5);
  s.osc1Detune += range(rng, -1, 1);
  return s;
}

// The safety net for generated sounds: no harsh, no silent, no swamp.
export function sanitize(input) {
  const s = clampState(input);
  // Audible: enough source level.
  if (s.osc1Level + s.osc2Level + s.subLevel < 0.5) s.osc1Level = 0.6;
  s.noiseLevel = Math.min(s.noiseLevel, s.archetype === 'ambient' ? 0.45 : 0.3);
  // Filters by type.
  if (s.filterType === 'lowpass') {
    if (s.cutoff < 80 && s.subLevel < 0.2) s.cutoff = 160;
    if (s.cutoff < 150 && s.envAmount < 0.15) s.cutoff = 150 + 100 * s.subLevel;
    if (s.envAmount < 0) s.cutoff = Math.max(s.cutoff, 600);
  } else if (s.filterType === 'highpass') {
    s.cutoff = Math.min(s.cutoff, 900);
    s.envAmount = clamp(s.envAmount, -0.3, 0.3);
  } else if (![s.osc1Wave, s.osc2Wave].some(w => w === 'sawtooth' || w === 'square')) {
    // A band-pass over sines and triangles is mostly silence; fall back to low-pass.
    s.filterType = 'lowpass';
    s.cutoff = Math.max(s.cutoff, 400);
  } else {
    s.cutoff = clamp(s.cutoff, 300, 2000);
    s.resonance = Math.min(s.resonance, 0.6);
    s.envAmount = clamp(s.envAmount, -0.3, 0.4);
  }
  // Resonance and drive feed each other into a whistle; keep them apart.
  s.resonance = Math.min(s.resonance, 0.85);
  if (s.resonance > 0.6) s.drive = Math.min(s.drive, 0.3);
  if (s.resonance * s.drive > 0.2) s.drive = 0.2 / s.resonance;
  // Bright + driven + high cutoff gets fizzy.
  if (s.cutoff > 5000 && s.drive > 0.35) s.drive = 0.35;
  // Envelopes: nothing that vanishes before it speaks.
  if (s.ampS < 0.05 && s.ampD < 0.08) s.ampD = 0.12;
  if (s.ampS < 0.05 && s.ampR < 0.05) s.ampR = 0.08;
  s.ampA = Math.min(s.ampA, 4);
  // Modulation stays tasteful.
  if (s.lfoTarget === 'pitch') s.lfoDepth = Math.min(s.lfoDepth, s.archetype === 'ambient' ? 0.35 : 0.25);
  if (s.lfoTarget === 'amp') s.lfoDepth = Math.min(s.lfoDepth, 0.6);
  if (!['bass', 'lead'].includes(s.archetype)) s.glide = Math.min(s.glide, 0.08);
  return clampState(s);
}

function generate(archetype, seed) {
  const rng = mulberry32(seed);
  const tools = makeTools(rng);
  const s = { ...DEFAULT_STATE, ...GENERATORS[archetype](tools), archetype, seed };
  mutate(s, rng);
  s.name = `${pick(rng, EPITHETS)} ${pick(rng, ARCH_NOUNS[archetype])}`;
  return sanitize(s);
}

// Smart random: pick an archetype by weight, generate within its ranges, mutate, sanitize.
export function summon(seed = 9990) {
  seed = (Number(seed) >>> 0);
  const archetype = weighted(mulberry32(seed ^ 0x9990), ARCH_WEIGHTS);
  return generate(archetype, seed);
}

// Same, with the archetype forced. Used by the sound bank.
export function summonArchetype(archetype, seed = 9990) {
  if (!GENERATORS[archetype]) archetype = 'keys';
  return generate(archetype, Number(seed) >>> 0);
}

// The next seed in a deterministic chain, so Summon walks 9990 -> ... reproducibly.
function nextSeed(seed) {
  return Math.floor(mulberry32((seed ^ 0x2545F491) >>> 0)() * 999999) + 1;
}

// ---------------------------------------------------------------------------
// Factory presets

const preset = o => Object.freeze(clampState({ ...DEFAULT_STATE, seed: 9990, ...o }));

export const FACTORY_PRESETS = Object.freeze([
  preset({
    name: 'Ninth Gate Pad', archetype: 'pad',
    osc1Wave: 'sawtooth', osc1Detune: -4, osc1Level: 0.6,
    osc2Wave: 'sawtooth', osc2Semi: 0, osc2Detune: 5, osc2Level: 0.55, osc2Unison: true, osc2Spread: 14,
    subLevel: 0.1, noiseLevel: 0.03,
    filterType: 'lowpass', cutoff: 1100, resonance: 0.2, envAmount: 0.15, keytrack: 0.4,
    ampA: 1.2, ampD: 1.5, ampS: 0.85, ampR: 2.8, fltA: 1.5, fltD: 2, fltS: 0.6, fltR: 2.5,
    lfoRate: 0.18, lfoTarget: 'filter', lfoDepth: 0.25, drive: 0.08, width: 0.75, gain: 0.75,
  }),
  preset({
    name: 'Juice of Saturn Pluck', archetype: 'pluck',
    osc1Wave: 'sawtooth', osc1Level: 0.75,
    osc2Wave: 'square', osc2Semi: 12, osc2Detune: 4, osc2Level: 0.3,
    subLevel: 0.15,
    filterType: 'lowpass', cutoff: 420, resonance: 0.35, envAmount: 0.7, keytrack: 0.7,
    ampA: 0.001, ampD: 0.35, ampS: 0, ampR: 0.3, fltA: 0.001, fltD: 0.18, fltS: 0, fltR: 0.2,
    lfoDepth: 0, drive: 0.2, width: 0.45,
  }),
  preset({
    name: '9990 Glide Bass', archetype: 'bass',
    osc1Wave: 'sawtooth', osc1Level: 0.7,
    osc2Wave: 'square', osc2Semi: 0, osc2Detune: -7, osc2Level: 0.35,
    subLevel: 0.7,
    filterType: 'lowpass', cutoff: 260, resonance: 0.3, envAmount: 0.45, keytrack: 0.3,
    ampA: 0.002, ampD: 0.5, ampS: 0.75, ampR: 0.12, fltA: 0.002, fltD: 0.25, fltS: 0.2, fltR: 0.15,
    lfoDepth: 0, glide: 0.07, mono: true, drive: 0.35, width: 0,
  }),
  preset({
    name: 'Hermes Lead', archetype: 'lead',
    osc1Wave: 'square', osc1Level: 0.6,
    osc2Wave: 'sawtooth', osc2Semi: 12, osc2Detune: 6, osc2Level: 0.45,
    subLevel: 0.2,
    filterType: 'lowpass', cutoff: 2200, resonance: 0.25, envAmount: 0.35, keytrack: 0.6,
    ampA: 0.01, ampD: 0.4, ampS: 0.8, ampR: 0.25, fltA: 0.005, fltD: 0.35, fltS: 0.45, fltR: 0.3,
    lfoRate: 5.6, lfoTarget: 'pitch', lfoDepth: 0.15, glide: 0.05, mono: true, drive: 0.25, width: 0.35,
  }),
  preset({
    name: 'Emerald Tablet Keys', archetype: 'keys',
    osc1Wave: 'triangle', osc1Level: 0.8,
    osc2Wave: 'sine', osc2Semi: 12, osc2Detune: 3, osc2Level: 0.35,
    subLevel: 0.1,
    filterType: 'lowpass', cutoff: 2600, resonance: 0.12, envAmount: 0.35, keytrack: 0.6,
    ampA: 0.002, ampD: 1.6, ampS: 0.25, ampR: 0.45, fltA: 0.002, fltD: 0.9, fltS: 0.3, fltR: 0.4,
    lfoRate: 4.2, lfoTarget: 'amp', lfoDepth: 0.18, drive: 0.12, width: 0.45,
  }),
  preset({
    name: 'Astral Bell', archetype: 'bell',
    osc1Wave: 'sine', osc1Level: 0.7,
    osc2Wave: 'sine', osc2Semi: 28, osc2Detune: 7, osc2Level: 0.35,
    filterType: 'lowpass', cutoff: 6000, resonance: 0.1, envAmount: 0.2, keytrack: 0.6,
    ampA: 0.001, ampD: 2.6, ampS: 0, ampR: 1.8, fltA: 0.001, fltD: 1.2, fltS: 0, fltR: 1,
    lfoDepth: 0, drive: 0.05, width: 0.7,
  }),
  preset({
    name: 'Choir of Seventy-Two', archetype: 'pad',
    osc1Wave: 'triangle', osc1Level: 0.55,
    osc2Wave: 'sawtooth', osc2Semi: 0, osc2Detune: 4, osc2Level: 0.5, osc2Unison: true, osc2Spread: 10,
    noiseLevel: 0.05,
    filterType: 'lowpass', cutoff: 1400, resonance: 0.45, envAmount: 0.1, keytrack: 0.5,
    ampA: 0.7, ampD: 1, ampS: 0.9, ampR: 2, fltA: 0.8, fltD: 1.5, fltS: 0.7, fltR: 2,
    lfoRate: 5, lfoTarget: 'pitch', lfoDepth: 0.1, drive: 0.05, width: 0.8, gain: 0.75,
  }),
  preset({
    name: 'Good Ending Brass', archetype: 'brass',
    osc1Wave: 'sawtooth', osc1Level: 0.7,
    osc2Wave: 'sawtooth', osc2Semi: 0, osc2Detune: 9, osc2Level: 0.55,
    subLevel: 0.15, noiseLevel: 0.02,
    filterType: 'lowpass', cutoff: 700, resonance: 0.15, envAmount: 0.5, keytrack: 0.7,
    ampA: 0.045, ampD: 0.6, ampS: 0.85, ampR: 0.3, fltA: 0.09, fltD: 0.5, fltS: 0.45, fltR: 0.3,
    lfoRate: 5, lfoTarget: 'pitch', lfoDepth: 0.07, drive: 0.25, width: 0.45,
  }),
]);

// ---------------------------------------------------------------------------
// User presets (localStorage). Every access is guarded: storage can be absent.

function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]').filter(p => p && p.name); } catch { return []; }
}
function storeUserPresets(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Shared resources

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const len = Math.floor(ctx.sampleRate * 2);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0), rng = mulberry32(9990);
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

// tanh soft clip over input domain [-1, 1] standing for x in [-3, 3].
const DRIVE_CURVE = (() => {
  const n = 2048, c = new Float32Array(n), k = 3, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
})();

// Hold a param at its current automated value from time t (with a fallback where
// cancelAndHoldAtTime is missing).
function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
}

function qFor(type, res) {
  // Lowpass/highpass Q is in dB in Web Audio; bandpass Q is the classic ratio.
  return type === 'bandpass' ? 0.6 + res * 10 : -3 + res * 21;
}

// ---------------------------------------------------------------------------
// The instrument

export function create(ctx, saved) {
  let state = clampState(saved || FACTORY_PRESETS[0]);
  const voices = [];
  const recent = []; // [{t, freq}] recent note starts, for time-aware glide
  let uiRoot = null;

  // Global chain
  const bus = ctx.createGain();
  const pre = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = DRIVE_CURVE;
  shaper.oversample = '2x';
  const post = ctx.createGain();
  const haas = ctx.createDelay(0.05);
  const merger = ctx.createChannelMerger(2);
  const output = ctx.createGain();
  bus.connect(pre); pre.connect(shaper); shaper.connect(post);
  post.connect(merger, 0, 0);
  post.connect(haas); haas.connect(merger, 0, 1);
  merger.connect(output);

  function applyGlobal(immediate) {
    const t = ctx.currentTime;
    const vals = [
      [pre.gain, 0.35 + state.drive * 1.65],
      [post.gain, 1 / (1 + state.drive * 1.2)],
      [haas.delayTime, state.width * 0.02],
      [output.gain, state.gain],
    ];
    for (const [p, v] of vals) {
      if (immediate) p.value = v; // only before any automation exists on these params
      else p.setTargetAtTime(v, t, 0.02);
    }
  }
  applyGlobal(true);

  // --- voices -------------------------------------------------------------

  function glideFrom(t) {
    let best = null;
    for (const r of recent) if (r.t < t - 1e-4 && (!best || r.t > best.t)) best = r;
    return best ? best.freq : null;
  }
  function remember(t, freq) {
    recent.push({ t, freq });
    if (recent.length > 32) recent.shift();
  }

  function sounding(v, t) { return v.start <= t + 1e-6 && v.end > t; }

  function choke(v, t, tau = 0.006) {
    if (v.end <= t) return;
    t = Math.max(t, v.start);
    holdAt(v.amp.gain, t);
    v.amp.gain.setTargetAtTime(0, t, tau);
    v.off = Math.min(v.off, t);
    v.end = t + tau * 8;
    v.stopAll(v.end);
  }

  function noteOn(midi, velocity = 0.85, time) {
    const s = state;
    const t = Math.max(time ?? ctx.currentTime, 0);
    const note = midi + s.transpose;
    const freq = mtof(note);
    const vel = clamp(velocity, 0, 1);

    // Mono: this note cuts whatever sounds at t, and is cut by whatever was
    // already scheduled to start after it.
    let cutAt = Infinity;
    if (s.mono) {
      for (const v of voices) {
        if (sounding(v, t)) choke(v, t);
        else if (v.start > t) cutAt = Math.min(cutAt, v.start);
      }
    } else {
      const live = voices.filter(v => sounding(v, t));
      if (live.length >= MAX_VOICES) {
        live.sort((a, b) => a.start - b.start);
        for (let i = 0; i <= live.length - MAX_VOICES; i++) choke(live[i], t, 0.004);
      }
    }

    const prevFreq = s.glide > 0 ? glideFrom(t) : null;
    remember(t, freq);

    const srcs = [];
    const mix = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    const trem = ctx.createGain();
    amp.gain.value = 0;
    filter.type = s.filterType;
    filter.frequency.value = clamp(s.cutoff * Math.pow(2, s.keytrack * (note - 60) / 12), 20, 20000);
    filter.Q.value = qFor(s.filterType, s.resonance);
    mix.connect(filter); filter.connect(amp); amp.connect(trem); trem.connect(bus);

    const levels = { osc1: null, osc2: [], sub: null, noise: null };
    function addOsc(wave, cents, level, dest) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.detune.value = cents;
      if (prevFreq && prevFreq !== freq) {
        o.frequency.setValueAtTime(prevFreq, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + s.glide);
      } else {
        o.frequency.setValueAtTime(freq, t);
      }
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g); g.connect(dest);
      o.start(t);
      srcs.push(o);
      return { o, g };
    }

    const uniN = s.osc2Unison ? 3 : 1;
    const srcSum = s.osc1Level + s.osc2Level + s.noiseLevel;
    // Band-pass keeps only a slice of the spectrum; make up for it so the level stays even.
    const bpMakeup = s.filterType === 'bandpass' ? 0.6 + 0.8 * Math.sqrt(qFor('bandpass', s.resonance)) : 1;
    mix.gain.value = bpMakeup / Math.max(1, srcSum);
    if (s.osc1Level > 0) levels.osc1 = addOsc(s.osc1Wave, s.osc1Semi * 100 + s.osc1Detune, s.osc1Level, mix);
    if (s.osc2Level > 0) {
      for (let i = 0; i < uniN; i++) {
        const spread = uniN === 1 ? 0 : (i - 1) * s.osc2Spread;
        levels.osc2.push(addOsc(s.osc2Wave, s.osc2Semi * 100 + s.osc2Detune + spread, s.osc2Level / Math.sqrt(uniN), mix));
      }
    }
    if (s.subLevel > 0) levels.sub = addOsc('sine', -1200, s.subLevel * 0.8, amp);
    if (s.noiseLevel > 0) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      n.loop = true;
      const g = ctx.createGain();
      g.gain.value = s.noiseLevel;
      n.connect(g); g.connect(mix);
      n.start(t, (note * 0.0137) % 1.9);
      srcs.push(n);
      levels.noise = { o: n, g };
    }

    // LFO, one per voice so it key-syncs.
    let lfo = null, lfoGain = null;
    if (s.lfoDepth > 0) {
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = s.lfoRate;
      lfoGain = ctx.createGain();
      lfo.connect(lfoGain);
      if (s.lfoTarget === 'pitch') {
        lfoGain.gain.value = s.lfoDepth * 60; // cents
        for (const o of srcs) if (o.detune) lfoGain.connect(o.detune);
      } else if (s.lfoTarget === 'filter') {
        lfoGain.gain.value = s.lfoDepth * 2400; // cents
        lfoGain.connect(filter.detune);
      } else {
        trem.gain.value = 1 - s.lfoDepth * 0.5;
        lfoGain.gain.value = s.lfoDepth * 0.5;
        lfoGain.connect(trem.gain);
      }
      lfo.start(t);
      srcs.push(lfo);
    }

    // Amp envelope
    const peak = 0.28 * (0.3 + 0.7 * vel);
    const ag = amp.gain;
    ag.setValueAtTime(0, t);
    ag.linearRampToValueAtTime(peak, t + s.ampA);
    ag.setTargetAtTime(peak * s.ampS, t + s.ampA, s.ampD / 4);

    // Filter envelope, on detune so keytrack and LFO stay independent.
    const envCents = s.envAmount * 4800 * (0.6 + 0.4 * vel);
    const fd = filter.detune;
    fd.setValueAtTime(0, t);
    if (envCents !== 0) {
      fd.linearRampToValueAtTime(envCents, t + s.fltA);
      fd.setTargetAtTime(envCents * s.fltS, t + s.fltA, s.fltD / 4);
    }

    const v = {
      midi, start: t, off: Infinity, end: Infinity,
      amp, filter, trem, mix, levels, lfo, srcs, note, ampR: s.ampR, fltR: s.fltR,
      stopAll(at) { for (const o of srcs) { try { o.stop(at); } catch { } } },
    };

    // With no sustain the voice ends by itself; let it, rather than waiting for noteOff.
    if (s.ampS < 0.001) {
      v.end = t + s.ampA + s.ampD * 1.6 + 0.05;
      v.stopAll(v.end);
    }

    srcs[0] && (srcs[0].onended = () => cleanup(v));
    if (!srcs.length) { // nothing to play (all levels zero): keep the bookkeeping honest
      v.end = t;
      mix.disconnect(); filter.disconnect(); amp.disconnect(); trem.disconnect();
      return;
    }
    voices.push(v);
    if (cutAt < Infinity) choke(v, cutAt);
  }

  function cleanup(v) {
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    for (const o of v.srcs) { try { o.disconnect(); } catch { } }
    for (const k of ['osc1', 'sub', 'noise']) if (v.levels[k]) { try { v.levels[k].g.disconnect(); } catch { } }
    for (const x of v.levels.osc2) { try { x.g.disconnect(); } catch { } }
    for (const n of [v.mix, v.filter, v.amp, v.trem]) { try { n.disconnect(); } catch { } }
  }

  function release(v, t) {
    t = Math.max(t, v.start + 0.005);
    if (t >= v.end) return;
    v.off = t;
    holdAt(v.amp.gain, t);
    v.amp.gain.setTargetAtTime(0, t, v.ampR / 5);
    holdAt(v.filter.detune, t);
    v.filter.detune.setTargetAtTime(0, t, v.fltR / 5);
    v.end = t + v.ampR * 1.2 + 0.05;
    v.stopAll(v.end);
  }

  function noteOff(midi, time) {
    const t = Math.max(time ?? ctx.currentTime, 0);
    let target = null;
    for (const v of voices) {
      if (v.midi !== midi || v.off !== Infinity || v.start > t + 1e-6) continue;
      if (!target || v.start < target.start) target = v;
    }
    if (target) release(target, t);
  }

  function playNote(midi, velocity, time, duration) {
    const t = Math.max(time ?? ctx.currentTime, 0);
    noteOn(midi, velocity, t);
    noteOff(midi, t + Math.max(0.01, duration || 0.25));
  }

  function allNotesOff(time) {
    const t = time ?? ctx.currentTime;
    for (const v of voices.slice()) {
      if (v.start > t) { v.stopAll(t); v.end = t; v.off = t; try { cleanup(v); } catch { } }
      else choke(v, t, 0.015);
    }
  }

  // --- params ------------------------------------------------------------

  function liveUpdate(key) {
    const t = ctx.currentTime, s = state;
    for (const v of voices) {
      if (v.end <= t) continue;
      if (key === 'cutoff' || key === 'keytrack') {
        v.filter.frequency.setTargetAtTime(clamp(s.cutoff * Math.pow(2, s.keytrack * (v.note - 60) / 12), 20, 20000), t, 0.02);
      } else if (key === 'resonance') {
        v.filter.Q.setTargetAtTime(qFor(v.filter.type, s.resonance), t, 0.02);
      } else if (key === 'filterType') {
        v.filter.type = s.filterType;
        v.filter.Q.setTargetAtTime(qFor(s.filterType, s.resonance), t, 0.02);
      } else if (key === 'lfoRate' && v.lfo) {
        v.lfo.frequency.setTargetAtTime(s.lfoRate, t, 0.05);
      } else if (key === 'osc1Level' && v.levels.osc1) {
        v.levels.osc1.g.gain.setTargetAtTime(s.osc1Level, t, 0.02);
      } else if (key === 'osc2Level') {
        for (const x of v.levels.osc2) x.g.gain.setTargetAtTime(s.osc2Level / Math.sqrt(v.levels.osc2.length), t, 0.02);
      } else if (key === 'subLevel' && v.levels.sub) {
        v.levels.sub.g.gain.setTargetAtTime(s.subLevel * 0.8, t, 0.02);
      } else if (key === 'noiseLevel' && v.levels.noise) {
        v.levels.noise.g.gain.setTargetAtTime(s.noiseLevel, t, 0.02);
      }
    }
  }

  function set(key, value) {
    if (!(key in DEFAULT_STATE)) return;
    state = clampState({ ...state, [key]: value });
    if (['drive', 'width', 'gain'].includes(key)) applyGlobal(false);
    else liveUpdate(key);
  }

  function setState(obj) {
    state = clampState(obj);
    applyGlobal(false);
    if (uiRoot) renderUI(uiRoot);
  }

  // --- UI ----------------------------------------------------------------

  const fmtHz = v => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '');
  const fmtSec = v => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's');
  const fmtPct = v => Math.round(v * 100) + '%';

  function renderUI(container) {
    uiRoot = container;
    container.textContent = '';
    const style = el('style');
    style.textContent = `
      .gk-plugin-sigil .sg-head { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
      .gk-plugin-sigil .sg-seed { width:7.5em; font:inherit; background:transparent; color:inherit;
        border:1px solid currentColor; border-radius:3px; padding:2px 4px; opacity:.85; }
      .gk-plugin-sigil .sg-sig { font-style:italic; opacity:.75; margin-left:4px; }
      .gk-plugin-sigil .gk-summon { letter-spacing:.12em; text-transform:uppercase; }
      .gk-plugin-sigil .gk-row { flex-wrap:wrap; }`;
    container.appendChild(style);

    const s = state;
    const K = (row, key, label, o = {}) => {
      const [lo, hi, step] = RANGES[key];
      const min = o.min ?? lo, max = o.max ?? hi;
      if (o.log) {
        const toN = x => Math.log(x / min) / Math.log(max / min);
        const fromN = n => min * Math.pow(max / min, n);
        return knob(row, {
          label, min: 0, max: 1, value: toN(clamp(s[key], min, max)), def: toN(clamp(DEFAULT_STATE[key], min, max)),
          format: n => (o.fmt || (x => x.toFixed(2)))(fromN(n)), onChange: n => set(key, fromN(n)),
        });
      }
      return knob(row, {
        label, min, max, step: o.step ?? step, value: s[key], def: DEFAULT_STATE[key],
        format: o.fmt, onChange: x => set(key, x),
      });
    };
    const W = (row, key, label) => select(row, {
      label, value: s[key], onChange: v => set(key, v),
      options: [{ label: 'sine', value: 'sine' }, { label: 'saw', value: 'sawtooth' }, { label: 'square', value: 'square' }, { label: 'tri', value: 'triangle' }],
    });

    // Presets
    const head = section(container, 'Grimoire');
    head.classList.add('sg-head');
    const users = loadUserPresets();
    const options = [{ label: '· ' + s.name, value: '' }]
      .concat(FACTORY_PRESETS.map((p, i) => ({ label: '✦ ' + p.name, value: 'f' + i })))
      .concat(users.map((p, i) => ({ label: p.name, value: 'u' + i })));
    select(head, {
      label: 'Preset', options, value: '',
      onChange: v => {
        if (!v) return;
        const p = v[0] === 'f' ? FACTORY_PRESETS[+v.slice(1)] : users[+v.slice(1)];
        if (p) setState(p);
      },
    });
    button(head, 'Save', () => {
      let name = s.name;
      try { name = window.prompt('Name this sigil', s.name) || ''; } catch { }
      name = name.trim();
      if (!name) return;
      state = clampState({ ...state, name });
      const list = loadUserPresets().filter(p => p.name !== name);
      list.push({ ...state });
      storeUserPresets(list);
      renderUI(container);
    });
    button(head, 'Delete', () => {
      const list = loadUserPresets();
      const next = list.filter(p => p.name !== state.name);
      if (next.length !== list.length) { storeUserPresets(next); renderUI(container); }
    });

    // Summon
    const sum = section(container, 'Summon');
    sum.classList.add('sg-head');
    button(sum, 'Summon', () => setState(summon(nextSeed(state.seed))), 'gk-summon');
    const seedIn = el('input', 'sg-seed');
    seedIn.type = 'number'; seedIn.min = '0'; seedIn.value = String(s.seed); seedIn.title = 'Seed';
    seedIn.addEventListener('keydown', e => { if (e.key === 'Enter') setState(summon(seedIn.value)); });
    sum.appendChild(seedIn);
    button(sum, 'Cast seed', () => setState(summon(seedIn.value)));
    sum.appendChild(el('span', 'sg-sig', `${s.name} (${s.archetype}, seed ${s.seed})`));

    let r = section(container, 'Osc I');
    W(r, 'osc1Wave', 'Wave');
    K(r, 'osc1Semi', 'Semi');
    K(r, 'osc1Detune', 'Fine', { fmt: v => v.toFixed(1) + 'c' });
    K(r, 'osc1Level', 'Level', { fmt: fmtPct });

    r = section(container, 'Osc II');
    W(r, 'osc2Wave', 'Wave');
    K(r, 'osc2Semi', 'Semi');
    K(r, 'osc2Detune', 'Fine', { fmt: v => v.toFixed(1) + 'c' });
    K(r, 'osc2Level', 'Level', { fmt: fmtPct });
    toggle(r, { label: 'Unison', value: s.osc2Unison, onChange: v => set('osc2Unison', v) });
    K(r, 'osc2Spread', 'Spread', { fmt: v => v.toFixed(0) + 'c' });

    r = section(container, 'Sub & Noise');
    K(r, 'subLevel', 'Sub', { fmt: fmtPct });
    K(r, 'noiseLevel', 'Noise', { fmt: fmtPct });

    r = section(container, 'Filter');
    select(r, {
      label: 'Type', value: s.filterType, onChange: v => set('filterType', v),
      options: [{ label: 'LP', value: 'lowpass' }, { label: 'BP', value: 'bandpass' }, { label: 'HP', value: 'highpass' }],
    });
    K(r, 'cutoff', 'Cutoff', { log: true, fmt: fmtHz });
    K(r, 'resonance', 'Res', { fmt: fmtPct });
    K(r, 'envAmount', 'Env amt', { fmt: v => (v > 0 ? '+' : '') + Math.round(v * 100) });
    K(r, 'keytrack', 'Keytrack', { fmt: fmtPct });

    r = section(container, 'Filter env');
    K(r, 'fltA', 'A', { log: true, fmt: fmtSec });
    K(r, 'fltD', 'D', { log: true, fmt: fmtSec });
    K(r, 'fltS', 'S', { fmt: fmtPct });
    K(r, 'fltR', 'R', { log: true, fmt: fmtSec });

    r = section(container, 'Amp env');
    K(r, 'ampA', 'A', { log: true, fmt: fmtSec });
    K(r, 'ampD', 'D', { log: true, fmt: fmtSec });
    K(r, 'ampS', 'S', { fmt: fmtPct });
    K(r, 'ampR', 'R', { log: true, fmt: fmtSec });

    r = section(container, 'LFO');
    K(r, 'lfoRate', 'Rate', { log: true, fmt: v => v.toFixed(2) + 'Hz' });
    select(r, { label: 'Target', value: s.lfoTarget, options: LFO_TARGETS, onChange: v => set('lfoTarget', v) });
    K(r, 'lfoDepth', 'Depth', { fmt: fmtPct });

    r = section(container, 'Voice');
    K(r, 'glide', 'Glide', { min: 0, max: 1, fmt: fmtSec });
    toggle(r, { label: 'Mono', value: s.mono, onChange: v => set('mono', v) });
    K(r, 'transpose', 'Transp', { fmt: v => (v > 0 ? '+' : '') + v + 'st' });
    K(r, 'drive', 'Drive', { fmt: fmtPct });
    K(r, 'width', 'Width', { fmt: fmtPct });
    K(r, 'gain', 'Gain', { fmt: fmtPct });
  }

  function dispose() {
    allNotesOff(ctx.currentTime);
    for (const v of voices.slice()) cleanup(v);
    for (const n of [bus, pre, shaper, post, haas, merger, output]) { try { n.disconnect(); } catch { } }
    uiRoot = null;
  }

  return {
    id: meta.id, name: meta.name, kind: 'instrument',
    output,
    noteOn, noteOff, playNote, allNotesOff,
    getState: () => ({ ...state }),
    setState, set, renderUI, dispose,
  };
}
