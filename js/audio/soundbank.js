// The grimoire's sound bank: 200 original sounds, all synthesized in code.
//
// Every sound is a family (kick, snare, hat, FM bell, formant choir, Sigil patch...)
// plus deterministic, seeded variation. Families are chosen per index with
// "flavors" so neighbours in a category differ in character, not just in a
// few percent of one knob.
//
// Engines:
//   buffer  one-shot drums and FX, rendered sample-by-sample into an AudioBuffer
//           once per context (re-rendered when Decay/Tone change). Pitch = playbackRate.
//   808     live sine voice with punch, drive and slide (mono, a new note glides
//           from the one still ringing).
//   fm      two-operator FM pairs (bells, electric pianos).
//   formant saw unison through parallel vowel formant filters (choirs).
//   sigil   a Sigil patch (js/plugins/sigil.js) with macro knobs on top.
//
// Everything is synchronous so OfflineAudioContext rendering works.

import { mulberry32 } from './rng.js';
import { create as createSigil, summonArchetype } from '../plugins/sigil.js';
import { knob, toggle, section } from '../ui/widgets.js';

const MAX_VOICES = 24;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------------------
// Names. One list per category; the list length is the category's count.

const NAMES = {
  Kicks: ["Saturn's Footfall", 'Foundation Stone', 'Leaden Heart', 'Prima Materia', 'Ninefold Thump', 'Obsidian Door',
    'Gravity Well', 'Iron Seal', 'Mountain Oath', 'Bedrock Rune', 'Pillar of Boaz', 'Cornerstone', 'Velvet Hammer', 'Earth Element'],
  '808s': ['9990 Slide', 'Long Night 808', 'Saturn Return', 'Bottomless Chalice', 'Leviathan Purr', 'Gravity Hymn',
    'Tectonic Psalm', 'Moon Under Water', 'Mercury Retrograde', 'Deep Ninth House', 'Basalt Tongue', 'Slow Orbit',
    'Low Tide Oracle', 'Ninefold Glide'],
  Snares: ['Crack of Dawn', "Scribe's Snap", 'Sealing Wax', 'Thunder Rune', 'Rune Splitter', 'Lightning Glyph',
    'Parchment Tear', 'Flint and Steel', 'Wand Strike', 'Bound Tome', 'Mars in Aries', 'Quicksilver Snap',
    'Lamplight Snare', 'Chalk Circle'],
  Claps: ['Congregation', 'Gemini Clap', 'Twin Palms', 'Applause of Angels', 'Circle Clap', 'Festival of Lights',
    'Hallowed Hall', 'Market Square'],
  Hats: ['Silver Needle', 'Mercury Tick', 'Drill Sigil', 'Hourglass Grain', 'Astrolabe Tick', 'Quicksilver Hat',
    'Glass Rosary', 'Clockwork Star', 'Spindle Hat', 'Crystal Ticker', 'Open Gate', 'Comet Tail', 'Sistrum Shimmer',
    'Chalice Wash', 'Brass Orrery Ride', 'Halo Ride'],
  Percussion: ['Chalice Rim', 'Drill Rim', 'Keystone Rim', 'Temple Tom', 'Low Altar Tom', 'Scarab Block', 'Abacus Block',
    'Taurus Cowbell', 'Seed Rattle', 'Sand Timer Shaker', 'Oasis Conga', 'Caravan Conga', 'Triangle of Art', 'Moon Tambourine'],
  FX: ['Ascension Riser', "Jacob's Ladder", 'Falling Star', 'Descent of Inanna', 'Tower Impact', 'Big Bang Boom',
    'Spellspark Zap', 'Wand Zap', 'Reverse Comet', 'Portal Whoosh'],
  Bass: ["Philosopher's Bass", 'Taurus Root', 'Reese of Solomon', 'Iron Foundation', 'Root Chakra', 'Earthen Groan',
    'Copper Coil Bass', 'Saturn Ring Bass', 'Deep Elixir', 'Lodestone', 'Ninth Wave Bass', 'Quiet Anchor',
    'Hermetic Reese', 'Mandrake Root'],
  Keys: ['Scriptorium EP', 'Velvet Codex', 'Library of Alexandria', 'Lamplit Tines', 'Sanctum Keys', 'Monastery Organ',
    'Illuminated Manuscript', 'Moonlit Lectern', 'Glass Harmonium', 'Celestial Clavier', "Archivist's Piano",
    'Midnight Folio', 'Tablet of Thoth', 'Candle Tines'],
  Pads: ['Akashic Record', 'Aurora Veil', 'Ninth Sphere', 'Celestial Canopy', 'Seraph Wings', 'Elysian Field',
    'Starlit Nave', 'Morning Star', 'Harmony of Spheres', 'Golden Dawn Pad', 'Lunar Mansion', 'Benediction',
    'Cathedral Brass', 'Triumph of Venus', 'Fanfare of Dawn', 'Good Omen Horns'],
  Leads: ['Phoenix Rising', 'Comet Lead', "Will-o'-Wisp", 'Sun Disc', 'Hermes Wing', "Prophet's Whistle", 'Pentacle Saw',
    'Starfire Lead', 'Ninth Ray', 'Silver Thread', 'Anthem of Nine', 'Herald of Saturn', 'Victory Horn', 'Procession Brass'],
  Plucks: ['Lyre of Orpheus', 'Harp of David', 'Rune Pluck', 'Seed of Life', 'Spark of Prometheus', 'Starseed',
    'Firefly Pluck', 'Glass Bead Game', 'Mercury Droplet', 'Quill Pluck', 'Lotus Pluck', 'Zodiac Pluck',
    'Dewdrop Elixir', 'Amber Pluck'],
  Bells: ['Bell of Atlantis', 'Temple Gong', 'Venus Chime', 'Celestial Orrery', 'Glass Armonica', 'Angelus Bell',
    'Crystal Ball Chime', 'Music Box of Hours', 'Singing Bowl', 'Wind Chime of Aether', 'Star Map Bell', 'Sanctus Bell'],
  'Vox/Choir': ['Voices of Enoch', 'Ahh of Aether', 'Ooh of the Abbey', 'Vespers', 'Gregorian Hum', "Angel's Breath",
    'Cherubim Ahh', 'Oracle Whisper', "Sibyl's Vowel", 'Hymn of Nine', 'Monastic Choir', 'Siren Song'],
  Textures: ['Astral Plane', 'Nebula Dust', 'Ether Wind', 'Liminal Room', 'Crystal Cave', 'Aurora Static', 'Moonlit Mist',
    'Tidal Oracle', "Alchemist's Steam", 'Starfield Hiss', 'Distant Cathedral', 'Aquarius Rain', 'Infinite Library',
    'Northern Lights'],
};

// ---------------------------------------------------------------------------
// Recipes. Each returns the engine and its parameters for variant i.

function tools(rng) {
  return {
    R: (lo, hi) => lo + rng() * (hi - lo),
    LR: (lo, hi) => Math.exp(Math.log(lo) + rng() * (Math.log(hi) - Math.log(lo))),
    P: arr => arr[Math.floor(rng() * arr.length)],
  };
}

const RECIPES = {
  Kicks(i, { R }) {
    const flavor = ['punch', 'boom', 'tight', 'dist', 'soft', 'click', 'boom'][i % 7];
    const F = {
      punch: { f0: [160, 240], sw: [0.025, 0.04], dec: [0.35, 0.5], click: 0.3, drive: 0.25 },
      boom: { f0: [110, 160], sw: [0.05, 0.08], dec: [0.7, 1.1], click: 0.1, drive: 0.15 },
      tight: { f0: [200, 320], sw: [0.012, 0.02], dec: [0.2, 0.3], click: 0.5, drive: 0.3 },
      dist: { f0: [150, 220], sw: [0.03, 0.05], dec: [0.4, 0.6], click: 0.3, drive: 0.8 },
      soft: { f0: [90, 130], sw: [0.04, 0.06], dec: [0.4, 0.6], click: 0.05, drive: 0 },
      click: { f0: [250, 400], sw: [0.008, 0.015], dec: [0.25, 0.35], click: 0.9, drive: 0.2 },
    }[flavor];
    return {
      engine: 'buffer', render: 'kick', tags: ['kick', flavor],
      f0: R(...F.f0), f1: R(42, 58), sweep: R(...F.sw), decay: R(...F.dec), hold: R(0.01, 0.05),
      click: F.click * R(0.8, 1.2), drive: clamp(F.drive + R(-0.05, 0.1), 0, 0.95),
    };
  },

  '808s'(i, { R }) {
    const flavor = ['clean', 'dist', 'punchy', 'long', 'short', 'reese', 'gritty'][i % 7];
    const F = {
      clean: { punch: [1.6, 2.2], dec: [1.4, 2], drive: [0.05, 0.2], det: 0 },
      dist: { punch: [2, 2.8], dec: [1.2, 1.8], drive: [0.6, 0.85], det: 0 },
      punchy: { punch: [2.8, 3.6], dec: [0.9, 1.3], drive: [0.3, 0.5], det: 0 },
      long: { punch: [1.5, 2], dec: [2.4, 3.2], drive: [0.15, 0.35], det: 0 },
      short: { punch: [2.2, 3], dec: [0.5, 0.8], drive: [0.25, 0.45], det: 0 },
      reese: { punch: [1.8, 2.4], dec: [1.5, 2.2], drive: [0.3, 0.5], det: 9 },
      gritty: { punch: [2.4, 3.2], dec: [1.2, 1.7], drive: [0.85, 1], det: 0 },
    }[flavor];
    return {
      engine: '808', tags: ['808', 'drill', 'slide', flavor],
      punch: R(...F.punch), punchTime: R(0.025, 0.06), decay: R(...F.dec), hold: R(0.04, 0.12),
      drive: R(...F.drive), detune: F.det, click: flavor === 'punchy' || flavor === 'short' ? R(0.3, 0.5) : R(0, 0.15),
      glide: R(0.06, 0.14),
    };
  },

  Snares(i, { R }) {
    const flavor = ['drill', 'tight', 'fat', 'rim', 'trap', 'lofi', 'crack'][i % 7];
    const F = {
      drill: { bf: [210, 250], bd: [0.035, 0.05], bl: 0.6, nl: 0.8, nd: [0.07, 0.1], hp: 1500, lp: 9000, snap: 0.9, drive: 0.3, ring: 0 },
      tight: { bf: [220, 280], bd: [0.03, 0.04], bl: 0.5, nl: 0.7, nd: [0.04, 0.06], hp: 2000, lp: 11000, snap: 0.6, drive: 0.15, ring: 0 },
      fat: { bf: [160, 200], bd: [0.06, 0.09], bl: 0.9, nl: 0.7, nd: [0.1, 0.15], hp: 800, lp: 7000, snap: 0.3, drive: 0.3, ring: 0 },
      rim: { bf: [300, 400], bd: [0.02, 0.03], bl: 0.5, nl: 0.4, nd: [0.03, 0.05], hp: 2500, lp: 12000, snap: 1, drive: 0.1, ring: 0.6 },
      trap: { bf: [180, 220], bd: [0.04, 0.06], bl: 0.55, nl: 0.9, nd: [0.08, 0.12], hp: 1200, lp: 10000, snap: 0.7, drive: 0.2, ring: 0 },
      lofi: { bf: [190, 230], bd: [0.04, 0.06], bl: 0.6, nl: 0.6, nd: [0.06, 0.09], hp: 600, lp: 4500, snap: 0.3, drive: 0.5, ring: 0 },
      crack: { bf: [240, 300], bd: [0.02, 0.03], bl: 0.4, nl: 1, nd: [0.05, 0.08], hp: 3000, lp: 14000, snap: 1, drive: 0.1, ring: 0.2 },
    }[flavor];
    return {
      engine: 'buffer', render: 'snare', tags: ['snare', flavor, ...(flavor === 'drill' || flavor === 'crack' ? ['drill', 'snap'] : [])],
      bodyF: R(...F.bf), bodyDecay: R(...F.bd), bodyLevel: F.bl, noiseLevel: F.nl, noiseDecay: R(...F.nd),
      noiseHP: F.hp * R(0.85, 1.15), noiseLP: F.lp * R(0.85, 1.15), snap: F.snap, drive: F.drive,
      ringF: R(1700, 2200), ringLevel: F.ring,
    };
  },

  Claps(i, { R }) {
    const big = i % 2 === 1;
    return {
      engine: 'buffer', render: 'clap', tags: ['clap', big ? 'big' : 'tight'],
      bursts: 3 + (i % 3), spacing: R(0.006, 0.013), freq: R(900, 1800), q: R(1, 2.2),
      tail: big ? R(0.15, 0.3) : R(0.06, 0.12), tailLevel: big ? 0.6 : 0.45, room: i % 4 === 3 ? 0.35 : 0,
    };
  },

  Hats(i, { R }) {
    // 0-5 drill-tight, 6-9 closed, 10-13 open, 14-15 ride
    const kind = i < 6 ? 'drill' : i < 10 ? 'closed' : i < 14 ? 'open' : 'ride';
    const K = {
      drill: { dec: [0.025, 0.045], hp: [8000, 10000], metal: 0.6, noise: 0.5, base: [380, 480] },
      closed: { dec: [0.05, 0.09], hp: [6500, 8000], metal: 0.5, noise: 0.6, base: [330, 430] },
      open: { dec: [0.3, 0.6], hp: [6000, 7500], metal: 0.6, noise: 0.5, base: [330, 430] },
      ride: { dec: [1.2, 1.8], hp: [4500, 5500], metal: 0.8, noise: 0.25, base: [260, 340] },
    }[kind];
    return {
      engine: 'buffer', render: 'hat', tags: ['hat', kind, ...(kind === 'drill' ? ['drill', 'rolls'] : [])],
      decay: R(...K.dec), hp: R(...K.hp), metal: K.metal * R(0.8, 1.2), noise: K.noise * R(0.8, 1.2), base: R(...K.base),
      bell: kind === 'ride' ? R(0.2, 0.35) : 0,
    };
  },

  Percussion(i, { R }) {
    const type = ['rim', 'rim', 'rim', 'tom', 'tom', 'block', 'block', 'cowbell', 'shaker', 'shaker', 'conga', 'conga', 'tri', 'tamb'][i];
    const base = { engine: 'buffer', render: 'perc', type, tags: ['perc', type, ...(type === 'rim' ? ['drill'] : [])] };
    switch (type) {
      case 'rim': return { ...base, f: [1750, 2100, 1550][i], tau: [0.01, 0.007, 0.014][i], body: [0.4, 0.25, 0.6][i] };
      case 'tom': return { ...base, f: i === 3 ? R(150, 190) : R(85, 110), decay: R(0.15, 0.25) };
      case 'block': return { ...base, f: i === 5 ? R(1100, 1400) : R(700, 900), decay: R(0.025, 0.04) };
      case 'cowbell': return { ...base, k: R(0.95, 1.05), decay: R(0.12, 0.2) };
      case 'shaker': return { ...base, f: i === 8 ? R(5000, 6500) : R(7000, 8500), decay: i === 8 ? R(0.04, 0.06) : R(0.025, 0.04) };
      case 'conga': return { ...base, f: i === 10 ? R(300, 380) : R(190, 240), decay: R(0.14, 0.2) };
      case 'tri': return { ...base, f: R(1200, 1500), decay: R(0.6, 0.9) };
      default: return { ...base, decay: R(0.08, 0.12) };
    }
  },

  FX(i, { R }) {
    const type = ['riser', 'riser', 'downer', 'downer', 'impact', 'impact', 'zap', 'zap', 'reverse', 'portal'][i];
    const len = { riser: R(2, 3), downer: R(1.2, 2), impact: 3, zap: 0.45, reverse: R(1.4, 1.8), portal: 2.5 }[type];
    return {
      engine: 'buffer', render: 'fx', type, len, tags: ['fx', type, ...(type === 'riser' || type === 'impact' ? ['transition'] : [])],
      variant: i % 2, fLo: R(150, 300), fHi: R(5000, 9000), zapHi: i === 6 ? 3200 : 1800, zapTau: i === 6 ? 0.03 : 0.06,
    };
  },

  Bass(i, { P }) {
    const flavor = ['reese', 'sub', 'pluck', 'summoned'][i % 4];
    const s = summonArchetype('bass', 9990 + i * 131);
    if (flavor === 'reese') Object.assign(s, { osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Unison: true, osc2Spread: 18, osc2Semi: 0, cutoff: 500, mono: true, lfoTarget: 'filter', lfoRate: 0.4, lfoDepth: 0.15, resonance: Math.min(s.resonance, 0.35) });
    if (flavor === 'sub') Object.assign(s, { subLevel: 0.85, osc1Level: 0.35, osc2Level: 0.15, cutoff: 220, drive: 0.15 });
    if (flavor === 'pluck') Object.assign(s, { ampS: 0.3, ampD: 0.35, envAmount: 0.6, fltD: 0.15, fltS: 0.05, osc1Wave: P(['sawtooth', 'square']) });
    return { engine: 'sigil', patch: s, tags: ['bass', flavor, ...(flavor === 'reese' ? ['drill'] : [])] };
  },

  Keys(i, { R, P }) {
    if (i % 2 === 0) {
      return {
        engine: 'fm', tags: ['keys', 'ep', 'fm'],
        pairs: [[1, 1, R(1.2, 2.6), 1], [1, P([14, 11, 7]), R(0.6, 1.4), 0.12]],
        indexSustain: R(0.2, 0.4), indexDecay: R(0.3, 0.8), attack: 0.002,
        decay: R(1.6, 3), sustain: R(0.12, 0.3), release: R(0.3, 0.5), detune: R(2, 6), trem: i % 4 === 0 ? R(3.5, 5) : 0,
      };
    }
    const s = summonArchetype('keys', 9990 + i * 211);
    if (i === 5) Object.assign(s, { osc1Wave: 'square', osc2Wave: 'sine', osc2Semi: 12, ampA: 0.01, ampS: 0.9, ampD: 0.5, ampR: 0.15, envAmount: 0.05, cutoff: 3000, lfoTarget: 'amp', lfoRate: 6, lfoDepth: 0.15 }); // organ
    return { engine: 'sigil', patch: s, tags: ['keys', i === 5 ? 'organ' : 'synth'] };
  },

  Pads(i) {
    if (i >= 12) {
      const s = summonArchetype('brass', 9990 + i * 307);
      Object.assign(s, { ampA: 0.18 + (i - 12) * 0.08, ampR: 1.2, osc2Unison: true, width: 0.7 });
      return { engine: 'sigil', patch: s, tags: ['pad', 'brass', 'anthem'] };
    }
    const s = summonArchetype(i % 4 === 3 ? 'ambient' : 'pad', 9990 + i * 307);
    return { engine: 'sigil', patch: s, tags: ['pad', 'anthem', i % 4 === 3 ? 'airy' : 'warm'] };
  },

  Leads(i) {
    if (i >= 10) {
      const s = summonArchetype('brass', 9990 + i * 401);
      return { engine: 'sigil', patch: s, tags: ['lead', 'brass', 'anthem'] };
    }
    const s = summonArchetype('lead', 9990 + i * 401);
    return { engine: 'sigil', patch: s, tags: ['lead', s.mono ? 'mono' : 'poly'] };
  },

  Plucks(i) {
    return { engine: 'sigil', patch: summonArchetype('pluck', 9990 + i * 503), tags: ['pluck'] };
  },

  Bells(i, { R }) {
    if (i < 9) {
      // Classic inharmonic FM ratios, one per bell.
      const ratio = [3.5, 1.4, 2.76, 7.0, 4.2, 1.73, 5.19, 2.0, 1.41][i];
      return {
        engine: 'fm', tags: ['bell', 'fm', i === 1 || i === 8 ? 'gong' : 'chime'],
        pairs: [[1, ratio, R(2, 4.5), 1], [R(2, 4.2), 1.5, R(0.5, 1.5), 0.25]],
        indexSustain: R(0.05, 0.2), indexDecay: R(0.5, 2), attack: i === 4 ? 0.06 : 0.001,
        decay: i === 1 || i === 8 ? R(4, 6) : R(2, 4), sustain: 0, release: R(1.5, 3), detune: R(1, 5), trem: 0,
      };
    }
    return { engine: 'sigil', patch: summonArchetype('bell', 9990 + i * 601), tags: ['bell', 'synth'] };
  },

  'Vox/Choir'(i, { R }) {
    const vowels = ['a', 'a', 'o', 'u', 'u', 'e', 'a', 'i', 'e', 'o', 'u', 'a'];
    return {
      engine: 'formant', tags: ['choir', 'vox', 'anthem', vowels[i]],
      vowel: vowels[i], shift: i % 3 === 1 ? 1.12 : i % 3 === 2 ? 0.92 : 1, // brighter / darker voices
      spread: R(8, 20), breath: i === 5 || i === 7 ? R(0.25, 0.4) : R(0.03, 0.1),
      attack: R(0.3, 1.0), release: R(1, 2.5), vibRate: R(4.6, 5.6), vibDepth: R(8, 20),
    };
  },

  Textures(i) {
    const s = summonArchetype('ambient', 9990 + i * 709);
    if (i % 3 === 0) Object.assign(s, { noiseLevel: 0.35, osc2Wave: 'sawtooth', filterType: 'bandpass', cutoff: 900, resonance: 0.4, envAmount: 0 });
    return { engine: 'sigil', patch: s, tags: ['texture', 'ambient', i % 3 === 0 ? 'noise' : 'tonal'] };
  },
};

const ORDER = ['Kicks', '808s', 'Snares', 'Claps', 'Hats', 'Percussion', 'FX',
  'Bass', 'Keys', 'Pads', 'Leads', 'Plucks', 'Bells', 'Vox/Choir', 'Textures'];
const DRUM_CATS = new Set(['Kicks', '808s', 'Snares', 'Claps', 'Hats', 'Percussion', 'FX']);
const SLUG = { Kicks: 'kick', '808s': '808', Snares: 'snare', Claps: 'clap', Hats: 'hat', Percussion: 'perc', FX: 'fx',
  Bass: 'bass', Keys: 'keys', Pads: 'pad', Leads: 'lead', Plucks: 'pluck', Bells: 'bell', 'Vox/Choir': 'vox', Textures: 'texture' };

const BY_ID = new Map();

export const SOUNDS = (() => {
  const out = [];
  ORDER.forEach((cat, ci) => {
    NAMES[cat].forEach((name, i) => {
      const id = `${SLUG[cat]}-${String(i + 1).padStart(2, '0')}`;
      const seed = (9990 + ci * 1009 + i * 7919) >>> 0;
      const recipe = RECIPES[cat](i, tools(mulberry32(seed)));
      recipe.seed = seed;
      if (recipe.patch) recipe.patch = { ...recipe.patch, name };
      const sound = Object.freeze({
        id, name, category: cat, kind: DRUM_CATS.has(cat) ? 'drum' : 'tonal', tags: Object.freeze([...new Set(recipe.tags)]),
      });
      out.push(sound);
      BY_ID.set(id, { sound, recipe });
    });
  });
  return Object.freeze(out);
})();

export function categories() { return ORDER.slice(); }

// ---------------------------------------------------------------------------
// Offline DSP for one-shots

class Biquad {
  constructor(type, f, q, sr) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q); }
  set(type, f, q) {
    const w = 2 * Math.PI * clamp(f, 10, this.sr * 0.45) / this.sr;
    const c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const sat = (x, d) => (d > 0 ? Math.tanh(x * (1 + d * 5)) / Math.tanh(1 + d * 5) : x);
const TAU = Math.PI * 2;

function renderKick(p, sr, dm, rnd) {
  const dec = p.decay * dm, len = Math.ceil((p.hold + dec * 1.2 + 0.02) * sr);
  const x = new Float32Array(len), hp = new Biquad('hp', 2000, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = p.f1 + (p.f0 - p.f1) * Math.exp(-t / p.sweep);
    ph += TAU * f / sr;
    const env = t < p.hold ? 1 : Math.exp(-(t - p.hold) * 5 / dec);
    const click = hp.p(rnd() * 2 - 1) * Math.exp(-t / 0.004) * p.click;
    x[i] = sat(Math.sin(ph) * env + click, p.drive);
  }
  return x;
}

function renderSnare(p, sr, dm, rnd) {
  const bd = p.bodyDecay * dm, nd = p.noiseDecay * dm;
  const len = Math.ceil((Math.max(bd, nd) * 6 + 0.02) * sr);
  const x = new Float32Array(len);
  const hp = new Biquad('hp', p.noiseHP, 0.7, sr), lp = new Biquad('lp', p.noiseLP, 0.7, sr), sh = new Biquad('hp', 3000, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += TAU * p.bodyF * (1 + 0.5 * Math.exp(-t / 0.01)) / sr;
    const body = (Math.sin(ph) + 0.4 * Math.sin(ph * 1.47)) * Math.exp(-t / bd) * p.bodyLevel;
    const w = rnd() * 2 - 1;
    const noise = lp.p(hp.p(w)) * Math.exp(-t / nd) * p.noiseLevel;
    const snap = sh.p(w) * Math.exp(-t / 0.0025) * p.snap;
    const ring = p.ringLevel ? Math.sin(TAU * p.ringF * t) * Math.exp(-t / 0.02) * p.ringLevel : 0;
    x[i] = sat(body + noise * 1.6 + snap + ring, p.drive);
  }
  return x;
}

function renderClap(p, sr, dm, rnd) {
  const last = (p.bursts - 1) * p.spacing, tail = p.tail * dm;
  const len = Math.ceil((last + tail * 6 + (p.room ? 0.4 * dm : 0) + 0.02) * sr);
  const x = new Float32Array(len);
  const bp = new Biquad('bp', p.freq, p.q, sr), hp = new Biquad('hp', 600, 0.7, sr), rlp = new Biquad('lp', 2500, 0.7, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let env = 0;
    for (let k = 0; k < p.bursts; k++) {
      const o = k * p.spacing;
      if (t >= o) env = Math.max(env, Math.exp(-(t - o) / 0.0035) * (k === p.bursts - 1 ? 1 : 0.8));
    }
    if (t >= last) env = Math.max(env, p.tailLevel * Math.exp(-(t - last) / tail));
    const w = rnd() * 2 - 1;
    let s = hp.p(bp.p(w)) * env * 2.5;
    if (p.room && t >= last) s += rlp.p(w) * p.room * Math.exp(-(t - last) / (0.12 * dm)) * 0.5;
    x[i] = s;
  }
  return x;
}

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
function renderHat(p, sr, dm, rnd) {
  const dec = p.decay * dm, len = Math.ceil((dec * 1.3 + 0.01) * sr);
  const x = new Float32Array(len);
  const h1 = new Biquad('hp', p.hp, 0.7, sr), h2 = new Biquad('hp', p.hp, 0.7, sr), bellBp = new Biquad('bp', p.base * 9, 4, sr);
  const ph = new Float64Array(6);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let m = 0;
    for (let k = 0; k < 6; k++) {
      ph[k] = (ph[k] + p.base * HAT_RATIOS[k] / sr) % 1;
      m += ph[k] < 0.5 ? 1 : -1;
    }
    m /= 6;
    const src = m * p.metal + (rnd() * 2 - 1) * p.noise;
    const env = Math.min(1, t / 0.0005) * Math.exp(-t * 5 / dec);
    let s = h2.p(h1.p(src)) * env;
    if (p.bell) s += bellBp.p(m) * p.bell * Math.exp(-t * 3 / dec) * 3;
    x[i] = s;
  }
  return x;
}

function renderPerc(p, sr, dm, rnd) {
  const lenFor = { rim: 0.12, tom: p.decay * 6, block: p.decay * 6, cowbell: p.decay * 6, shaker: p.decay * 7 + 0.02,
    conga: p.decay * 6, tri: p.decay * 5, tamb: p.decay * 6 + 0.05 }[p.type];
  const len = Math.ceil((lenFor * dm + 0.02) * sr);
  const x = new Float32Array(len);
  const faF = p.type === 'shaker' ? p.f : p.type === 'conga' ? 1500 : (p.f || 2000) * 1.8;
  const fa = new Biquad('bp', faF, p.type === 'shaker' ? 1 : 2, sr);
  const fb = new Biquad('lp', 3000, 0.7, sr);
  const fc = new Biquad('bp', 2600 * (p.k || 1), 1.4, sr);
  const fd = new Biquad('hp', 6500, 0.7, sr);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, w = rnd() * 2 - 1;
    let s = 0;
    switch (p.type) {
      case 'rim':
        s = Math.sin(TAU * p.f * t) * Math.exp(-t / (p.tau * dm)) * 0.8
          + Math.sin(TAU * p.f * 0.29 * t) * Math.exp(-t / (0.02 * dm)) * p.body
          + fa.p(w) * Math.exp(-t / 0.003) * 0.8;
        break;
      case 'tom':
        ph += TAU * p.f * (1 + 0.7 * Math.exp(-t / 0.04)) / sr;
        s = Math.sin(ph) * Math.exp(-t / (p.decay * dm)) + fb.p(w) * Math.exp(-t / 0.01) * 0.2;
        break;
      case 'block':
        s = Math.sin(TAU * p.f * t) * Math.exp(-t / (p.decay * dm)) + Math.sin(TAU * p.f * 2.7 * t) * Math.exp(-t / 0.01) * 0.4;
        break;
      case 'cowbell': {
        const a = (t * 540 * p.k) % 1 < 0.5 ? 1 : -1, b = (t * 800 * p.k) % 1 < 0.5 ? 1 : -1;
        s = fc.p((a + b) * 0.5) * (0.6 * Math.exp(-t / 0.02) + 0.4 * Math.exp(-t / (p.decay * dm))) * 1.5;
        break;
      }
      case 'shaker':
        s = fa.p(w) * (1 - Math.exp(-t / 0.006)) * Math.exp(-t / (p.decay * dm)) * 2;
        break;
      case 'conga':
        ph += TAU * p.f * (1 + 0.25 * Math.exp(-t / 0.015)) / sr;
        s = Math.sin(ph) * Math.exp(-t / (p.decay * dm)) + fa.p(w) * Math.exp(-t / 0.006) * 0.35;
        break;
      case 'tri':
        ph += TAU * p.f / sr;
        s = (0.6 * Math.sin(ph) + 0.3 * Math.sin(ph * 2.32) + 0.2 * Math.sin(ph * 4.25) + 0.1 * Math.sin(ph * 6.63))
          * Math.exp(-t / (p.decay * dm)) + fd.p(w) * Math.exp(-t / 0.002) * 0.3;
        break;
      default: { // tambourine: jingles + noise, two grains
        ph2 = (ph2 + 3100 / sr) % 1;
        const jingle = (ph2 < 0.5 ? 1 : -1) * 0.3 + w;
        const env = Math.exp(-t / (p.decay * dm)) + (t > 0.03 ? 0.5 * Math.exp(-(t - 0.03) / (p.decay * dm * 0.7)) : 0);
        s = fd.p(jingle) * env * 1.5;
      }
    }
    x[i] = s;
  }
  return x;
}

function renderFx(p, sr, dm, rnd) {
  const L = p.len * (p.type === 'impact' || p.type === 'zap' ? dm : clamp(dm, 0.5, 2));
  const len = Math.ceil(L * sr);
  const x = new Float32Array(len);
  const bp = new Biquad('bp', 500, 3, sr), lp = new Biquad('lp', 2000, 0.7, sr), lp2 = new Biquad('lp', 600, 0.7, sr);
  const hp = new Biquad('hp', 4000, 0.7, sr);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr, u = t / L, w = rnd() * 2 - 1;
    let s = 0;
    switch (p.type) {
      case 'riser': {
        const f = p.fLo * Math.pow(p.fHi / p.fLo, u);
        if ((i & 63) === 0) bp.set('bp', f, 3);
        ph += TAU * (200 * Math.pow(8, u)) / sr;
        s = (bp.p(w) * 2.5 + Math.sin(ph) * (p.variant ? 0.35 : 0.15)) * u * u;
        break;
      }
      case 'downer': {
        ph += TAU * (1200 * Math.pow(40 / 1200, Math.pow(u, 0.7))) / sr;
        if ((i & 63) === 0) lp.set('lp', 6000 * Math.pow(0.03, u), 0.9);
        s = (Math.sin(ph) * 0.7 + lp.p(w) * (p.variant ? 0.6 : 0.3)) * Math.pow(1 - u, 1.5);
        break;
      }
      case 'impact': {
        ph += TAU * (35 + 25 * Math.exp(-t / 0.2)) / sr;
        s = Math.sin(ph) * Math.exp(-t / (0.6 * dm)) * 0.9
          + lp.p(w) * Math.exp(-t / 0.08) * (p.variant ? 0.9 : 0.6)
          + lp2.p(w) * Math.exp(-t / (0.5 * dm)) * 0.5;
        s = sat(s, 0.3);
        break;
      }
      case 'zap':
        ph += TAU * (120 + p.zapHi * Math.exp(-t / p.zapTau)) / sr;
        s = Math.sin(ph) * Math.exp(-t / (0.1 * dm)) + (Math.sin(ph * 2) > 0 ? 0.15 : -0.15) * Math.exp(-t / 0.05);
        break;
      case 'reverse': {
        // A crash, rendered backwards: metal + noise swelling into the downbeat.
        const tr = L - t;
        ph2 = 0;
        for (let k = 0; k < 6; k++) ph2 += Math.sin(TAU * 320 * HAT_RATIOS[k] * tr) > 0 ? 1 : -1;
        s = hp.p(ph2 / 6 * 0.5 + w * 0.7) * Math.exp(-tr / 0.5) * Math.min(1, tr / 0.005);
        break;
      }
      default: { // portal: a wobbling, rising band of air over a vibrato tone
        const center = 400 * Math.pow(6, u) * (1 + 0.35 * Math.sin(TAU * 6 * t));
        if ((i & 63) === 0) bp.set('bp', center, 4);
        ph += TAU * 220 * (1 + 0.3 * Math.sin(TAU * 3 * t)) / sr;
        s = (bp.p(w) * 2.5 + Math.sin(ph) * 0.25) * Math.sin(Math.PI * u);
      }
    }
    x[i] = s;
  }
  return x;
}

const RENDER = { kick: renderKick, snare: renderSnare, clap: renderClap, hat: renderHat, perc: renderPerc, fx: renderFx };

// Spectral tilt (Tone knob): split at 1.5 kHz, scale the top by 2^(1.5*tone).
function tilt(x, tone, sr) {
  if (Math.abs(tone) < 0.01) return;
  const a = Math.exp(-TAU * 1500 / sr), hiGain = Math.pow(2, tone * 1.5);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y + (x[i] - y) * hiGain; }
}

function finish(x, sr, peakTarget) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 1e-6 ? peakTarget / peak : 0;
  const fade = Math.min(x.length, Math.floor(sr * 0.004));
  for (let i = 0; i < x.length; i++) x[i] *= g;
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
  return x;
}

const bufferCache = new WeakMap();
function drumBuffer(ctx, id, recipe, decay, tone) {
  let m = bufferCache.get(ctx);
  if (!m) { m = new Map(); bufferCache.set(ctx, m); }
  const key = `${id}|${decay.toFixed(2)}|${tone.toFixed(2)}`;
  let b = m.get(key);
  if (b) return b;
  const sr = ctx.sampleRate;
  const x = RENDER[recipe.render](recipe, sr, decay, mulberry32(recipe.seed));
  tilt(x, tone, sr);
  finish(x, sr, recipe.render === 'fx' ? 0.8 : 0.9);
  b = ctx.createBuffer(1, Math.max(1, x.length), sr);
  b.getChannelData(0).set(x);
  if (m.size > 300) m.delete(m.keys().next().value);
  m.set(key, b);
  return b;
}

const clickCache = new WeakMap();
function clickBuffer(ctx) {
  let b = clickCache.get(ctx);
  if (!b) {
    const sr = ctx.sampleRate, n = Math.ceil(sr * 0.012), rnd = mulberry32(9990), hp = new Biquad('hp', 1800, 0.7, sr);
    b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = hp.p(rnd() * 2 - 1) * Math.exp(-i / sr / 0.0025);
    clickCache.set(ctx, b);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Scheduled voices and a tiny host. Voices are reasoned about by ctx time
// (start/off/end), so out-of-order scheduling and offline rendering both work.

function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
}

function makeVoice(midi, t, amp, srcs, nodes, rel) {
  const v = {
    midi, start: t, off: Infinity, end: Infinity, amp, srcs, nodes, rel,
    stop(at) { for (const s of srcs) { try { s.stop(at); } catch { } } },
    release(at) {
      at = Math.max(at, v.start + 0.005);
      if (at >= v.end) return;
      v.off = at;
      holdAt(amp.gain, at);
      amp.gain.setTargetAtTime(0, at, v.rel / 5);
      v.end = at + v.rel * 1.2 + 0.05;
      v.stop(v.end);
    },
    kill(at, tau = 0.005) {
      if (at >= v.end) return;
      at = Math.max(at, v.start);
      holdAt(amp.gain, at);
      amp.gain.setTargetAtTime(0, at, tau);
      v.off = Math.min(v.off, at);
      v.end = at + tau * 8;
      v.stop(v.end);
    },
    dispose() { for (const n of [...srcs, ...nodes, amp]) { try { n.disconnect(); } catch { } } },
  };
  return v;
}

function makeHost() {
  const voices = [];
  const sounding = t => voices.filter(v => v.start <= t + 1e-6 && v.end > t);
  return {
    voices, sounding,
    admit(t) {
      const live = sounding(t);
      if (live.length < MAX_VOICES) return;
      live.sort((a, b) => a.start - b.start);
      for (let i = 0; i <= live.length - MAX_VOICES; i++) live[i].kill(t, 0.004);
    },
    track(v) {
      voices.push(v);
      if (v.srcs[0]) v.srcs[0].onended = () => {
        const i = voices.indexOf(v);
        if (i >= 0) voices.splice(i, 1);
        v.dispose();
      };
    },
    noteOff(midi, t) {
      let target = null;
      for (const v of voices) {
        if (v.midi !== midi || v.off !== Infinity || v.start > t + 1e-6) continue;
        if (!target || v.start < target.start) target = v;
      }
      if (target) target.release(t);
    },
    allOff(t) { for (const v of voices.slice()) v.kill(t, 0.012); },
    disposeAll() { for (const v of voices.splice(0)) { v.stop(0); v.dispose(); } },
  };
}

// ---------------------------------------------------------------------------
// Engines. Each returns { noteOn, noteOff, allNotesOff, apply(key), dispose }.

function bufferEngine(ctx, sound, recipe, st, out) {
  const host = makeHost();
  let buf = drumBuffer(ctx, sound.id, recipe, st.decay, st.tone);
  return {
    noteOn(midi, vel, t) {
      host.admit(t);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const rate = Math.pow(2, (midi - 60 + st.pitch) / 12);
      src.playbackRate.value = rate;
      const amp = ctx.createGain();
      amp.gain.value = 0.25 + 0.75 * vel;
      src.connect(amp); amp.connect(out);
      src.start(t);
      const v = makeVoice(midi, t, amp, [src], [], 0.05);
      v.end = t + buf.duration / rate;
      v.release = () => { }; // one-shots ring out
      host.track(v);
    },
    noteOff() { },
    allNotesOff: t => host.allOff(t),
    apply(key) { if (key === 'decay' || key === 'tone') buf = drumBuffer(ctx, sound.id, recipe, st.decay, st.tone); },
    dispose: () => host.disposeAll(),
  };
}

function curveFor(drive) {
  const n = 1024, c = new Float32Array(n), k = 1 + drive * 6, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}

// 808: mono. MIDI 60 plays the root at C2 (65.4 Hz), so the default drum-lane
// pitch lands where an 808 belongs. A note that starts while another rings
// slides from that pitch over `glide` seconds and takes over.
function engine808(ctx, sound, recipe, st, out) {
  const host = makeHost();
  const shaper = ctx.createWaveShaper();
  shaper.curve = curveFor(st.drive);
  shaper.oversample = '2x';
  const trim = ctx.createGain();
  trim.gain.value = 0.8;
  shaper.connect(trim); trim.connect(out);

  return {
    noteOn(midi, vel, t) {
      const f = mtof(midi - 24 + st.pitch);
      let from = null, cutAt = Infinity;
      for (const v of host.voices) {
        if (v.start <= t + 1e-6 && v.end > t) { if (v.start < t - 1e-4) from = v.freq; v.kill(t, 0.006); }
        else if (v.start > t) cutAt = Math.min(cutAt, v.start);
      }
      const amp = ctx.createGain();
      const peak = 0.75 * (0.35 + 0.65 * vel);
      const dec = recipe.decay * st.decay;
      amp.gain.value = 0;
      amp.connect(shaper);
      const srcs = [], nodes = [];
      const mk = det => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.detune.value = det;
        if (from && st.glide > 0) {
          o.frequency.setValueAtTime(from, t);
          o.frequency.exponentialRampToValueAtTime(f, t + st.glide);
        } else {
          o.frequency.setValueAtTime(f * recipe.punch, t);
          o.frequency.exponentialRampToValueAtTime(f, t + recipe.punchTime);
        }
        o.connect(amp); o.start(t); srcs.push(o);
      };
      mk(0);
      if (recipe.detune) mk(recipe.detune);
      if (recipe.click > 0 && !from) {
        const c = ctx.createBufferSource(), cg = ctx.createGain();
        c.buffer = clickBuffer(ctx);
        cg.gain.value = recipe.click * (1 + st.tone);
        c.connect(cg); cg.connect(amp); c.start(t);
        srcs.push(c); nodes.push(cg);
      }
      const atk = from ? 0.006 : 0.003;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + atk);
      amp.gain.setTargetAtTime(0, t + atk + recipe.hold, dec / 5);
      const v = makeVoice(midi, t, amp, srcs, nodes, 0.08);
      v.freq = f;
      v.end = t + atk + recipe.hold + dec * 1.3;
      v.stop(v.end);
      if (!st.gate) v.release = () => { };
      host.track(v);
      if (cutAt < Infinity) v.kill(cutAt, 0.006);
    },
    noteOff: (midi, t) => host.noteOff(midi, t),
    allNotesOff: t => host.allOff(t),
    apply(key) { if (key === 'drive') shaper.curve = curveFor(st.drive); },
    dispose() { host.disposeAll(); try { shaper.disconnect(); trim.disconnect(); } catch { } },
  };
}

function fmEngine(ctx, sound, recipe, st, out) {
  const host = makeHost();
  return {
    noteOn(midi, vel, t) {
      host.admit(t);
      const f = mtof(midi + st.pitch), r = recipe;
      const idxScale = Math.pow(2, st.tone);
      const dec = r.decay * st.decay, rel = r.release * st.decay;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      amp.connect(out);
      const srcs = [], nodes = [];
      r.pairs.forEach(([cr, mr, index, level], k) => {
        const car = ctx.createOscillator(), mod = ctx.createOscillator(), dev = ctx.createGain(), lvl = ctx.createGain();
        const fc = f * cr, fm = fc * mr, d = index * fm * idxScale;
        car.frequency.value = fc;
        if (k === 0) car.detune.value = r.detune;
        mod.frequency.value = fm;
        dev.gain.setValueAtTime(d, t);
        dev.gain.setTargetAtTime(d * r.indexSustain, t, (k === 0 ? r.indexDecay : r.indexDecay * 0.3) / 3);
        lvl.gain.value = level;
        mod.connect(dev); dev.connect(car.frequency); car.connect(lvl); lvl.connect(amp);
        car.start(t); mod.start(t);
        srcs.push(car, mod); nodes.push(dev, lvl);
      });
      if (r.trem) {
        const lfo = ctx.createOscillator(), lg = ctx.createGain(), trem = ctx.createGain();
        // Re-route: amp -> trem -> out, with the LFO wobbling trem's gain.
        amp.disconnect(); amp.connect(trem); trem.connect(out);
        trem.gain.value = 0.85; lfo.frequency.value = r.trem; lg.gain.value = 0.15;
        lfo.connect(lg); lg.connect(trem.gain); lfo.start(t);
        srcs.push(lfo); nodes.push(lg, trem);
      }
      const peak = 0.22 * (0.3 + 0.7 * vel);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + r.attack);
      amp.gain.setTargetAtTime(peak * r.sustain, t + r.attack, dec / 4);
      const v = makeVoice(midi, t, amp, srcs, nodes, rel);
      if (r.sustain < 0.001) { v.end = t + r.attack + dec * 1.6 + 0.05; v.stop(v.end); }
      host.track(v);
    },
    noteOff: (midi, t) => host.noteOff(midi, t),
    allNotesOff: t => host.allOff(t),
    apply() { },
    dispose: () => host.disposeAll(),
  };
}

// Formant frequencies (Hz) for sung vowels, alto-ish; gains fall off upward.
const VOWELS = {
  a: [800, 1150, 2800], e: [400, 1600, 2700], i: [300, 2100, 2900], o: [450, 800, 2830], u: [325, 700, 2530],
};
const FORMANT_GAIN = [1, 0.5, 0.25];
const FORMANT_BW = [110, 130, 170];

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const n = Math.floor(ctx.sampleRate * 2), rnd = mulberry32(9991);
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

function formantEngine(ctx, sound, recipe, st, out) {
  const host = makeHost();
  return {
    noteOn(midi, vel, t) {
      host.admit(t);
      const r = recipe, f = mtof(midi + st.pitch);
      const shift = r.shift * Math.pow(2, st.tone * 0.35);
      const src = ctx.createGain();
      src.gain.value = 0.33;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      amp.connect(out);
      const srcs = [], nodes = [src];
      // Vibrato that eases in after the attack.
      const lfo = ctx.createOscillator(), vib = ctx.createGain();
      lfo.frequency.value = r.vibRate;
      vib.gain.setValueAtTime(0, t);
      vib.gain.linearRampToValueAtTime(r.vibDepth, t + r.attack + 0.4);
      lfo.connect(vib);
      for (const c of [-1, 0, 1]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = c * r.spread;
        vib.connect(o.detune);
        o.connect(src);
        o.start(t);
        srcs.push(o);
      }
      lfo.start(t);
      srcs.push(lfo); nodes.push(vib);
      if (r.breath > 0) {
        const n = ctx.createBufferSource(), ng = ctx.createGain();
        n.buffer = noiseBuffer(ctx); n.loop = true;
        ng.gain.value = r.breath;
        n.connect(ng); ng.connect(src);
        n.start(t, (midi * 0.0173) % 1.9);
        srcs.push(n); nodes.push(ng);
      }
      VOWELS[r.vowel].forEach((F, k) => {
        const bp = ctx.createBiquadFilter(), g = ctx.createGain();
        const fq = Math.min(F * shift, ctx.sampleRate * 0.45);
        bp.type = 'bandpass';
        bp.frequency.value = fq;
        bp.Q.value = fq / FORMANT_BW[k];
        g.gain.value = FORMANT_GAIN[k] * 4;
        src.connect(bp); bp.connect(g); g.connect(amp);
        nodes.push(bp, g);
      });
      const peak = 0.3 * (0.35 + 0.65 * vel);
      const atk = r.attack * clamp(st.decay, 0.25, 2);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + atk);
      amp.gain.setTargetAtTime(peak * 0.85, t + atk, 0.4);
      host.track(makeVoice(midi, t, amp, srcs, nodes, r.release * st.decay));
    },
    noteOff: (midi, t) => host.noteOff(midi, t),
    allNotesOff: t => host.allOff(t),
    apply() { },
    dispose: () => host.disposeAll(),
  };
}

// Sigil patch with macros: Tone moves cutoff, Length scales the envelopes, Pitch transposes.
function sigilEngine(ctx, sound, recipe, st, out) {
  const base = recipe.patch;
  const syn = createSigil(ctx, base);
  syn.output.connect(out);
  const apply = key => {
    if (key === 'tone') syn.set('cutoff', clamp(base.cutoff * Math.pow(2, st.tone * 1.5), 30, 18000));
    if (key === 'decay') for (const k of ['ampD', 'ampR', 'fltD', 'fltR']) syn.set(k, base[k] * st.decay);
    if (key === 'pitch') syn.set('transpose', clamp((base.transpose || 0) + st.pitch, -24, 24));
  };
  ['tone', 'decay', 'pitch'].forEach(apply);
  return {
    noteOn: (m, v, t) => syn.noteOn(m, v, t),
    noteOff: (m, t) => syn.noteOff(m, t),
    allNotesOff: t => syn.allNotesOff(t),
    apply,
    dispose: () => syn.dispose(),
  };
}

const ENGINES = { buffer: bufferEngine, 808: engine808, fm: fmEngine, formant: formantEngine, sigil: sigilEngine };

// ---------------------------------------------------------------------------
// Public: build a playable instrument for one sound.

export function createSoundInstrument(ctx, soundId, state) {
  const entry = BY_ID.get(soundId) || BY_ID.get(SOUNDS[0].id);
  const { sound, recipe } = entry;
  const is808 = recipe.engine === '808';
  const defaults = { gain: 1, pitch: 0, decay: 1, tone: 0, ...(is808 ? { glide: recipe.glide, drive: recipe.drive, gate: false } : {}) };
  const st = sanitizeState({ ...defaults, ...(state || {}) }, defaults);

  const out = ctx.createGain();
  out.gain.value = st.gain;
  const eng = ENGINES[recipe.engine](ctx, sound, recipe, st, out);

  const now = () => ctx.currentTime;
  let uiRoot = null;
  const inst = {
    id: sound.id, name: sound.name, kind: 'instrument',
    output: out,
    noteOn(midi, velocity = 0.85, time) {
      eng.noteOn(midi, clamp(velocity, 0, 1), Math.max(0, time ?? now()));
    },
    noteOff(midi, time) { eng.noteOff(midi, Math.max(0, time ?? now())); },
    playNote(midi, velocity, time, duration) {
      const t = Math.max(0, time ?? now());
      inst.noteOn(midi, velocity, t);
      inst.noteOff(midi, t + Math.max(0.01, duration || 0.25));
    },
    allNotesOff(time) { eng.allNotesOff(time ?? now()); },
    getState: () => ({ ...st }),
    setState(obj) {
      Object.assign(st, sanitizeState({ ...defaults, ...(obj || {}) }, defaults));
      out.gain.setTargetAtTime(st.gain, now(), 0.02);
      for (const k in st) eng.apply(k);
      if (uiRoot) inst.renderUI(uiRoot);
    },
    set(key, value) {
      if (!(key in defaults)) return;
      Object.assign(st, sanitizeState({ ...st, [key]: value }, defaults));
      if (key === 'gain') out.gain.setTargetAtTime(st.gain, now(), 0.02);
      else eng.apply(key);
    },
    renderUI(container) {
      uiRoot = container;
      container.textContent = '';
      const r = section(container, `${sound.name} · ${sound.category}`);
      const pct = v => Math.round(v * 100) + '%';
      knob(r, { label: 'Gain', min: 0, max: 1.5, value: st.gain, def: 1, format: pct, onChange: v => inst.set('gain', v) });
      knob(r, { label: 'Pitch', min: -24, max: 24, step: 1, value: st.pitch, def: 0, format: v => (v > 0 ? '+' : '') + v + 'st', onChange: v => inst.set('pitch', v) });
      knob(r, { label: sound.kind === 'drum' ? 'Decay' : 'Length', min: 0.25, max: 2, value: st.decay, def: 1, format: v => v.toFixed(2) + 'x', onChange: v => inst.set('decay', v) });
      knob(r, { label: 'Tone', min: -1, max: 1, value: st.tone, def: 0, format: v => (v > 0 ? '+' : '') + Math.round(v * 100), onChange: v => inst.set('tone', v) });
      if (is808) {
        const r2 = section(container, '808');
        knob(r2, { label: 'Glide', min: 0, max: 0.4, value: st.glide, def: recipe.glide, format: v => Math.round(v * 1000) + 'ms', onChange: v => inst.set('glide', v) });
        knob(r2, { label: 'Drive', min: 0, max: 1, value: st.drive, def: recipe.drive, format: pct, onChange: v => inst.set('drive', v) });
        toggle(r2, { label: 'Gate', value: st.gate, onChange: v => inst.set('gate', v) });
      }
    },
    dispose() {
      try { eng.allNotesOff(now()); } catch { }
      eng.dispose();
      try { out.disconnect(); } catch { }
      uiRoot = null;
    },
  };
  return inst;
}

function sanitizeState(s, defaults) {
  const lim = { gain: [0, 1.5], pitch: [-24, 24], decay: [0.25, 2], tone: [-1, 1], glide: [0, 0.4], drive: [0, 1] };
  const out = {};
  for (const k in defaults) {
    if (k === 'gate') { out.gate = !!s.gate; continue; }
    let v = Number(s[k]);
    if (!Number.isFinite(v)) v = defaults[k];
    out[k] = clamp(v, ...lim[k]);
  }
  out.pitch = Math.round(out.pitch);
  return out;
}
