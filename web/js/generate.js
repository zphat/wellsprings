// The offline brain: Mystery Box, MIDI Mashup and most of Murmur's tricks.
// No network needed. Everything is seeded, so any song can be reproduced from
// its style, vibe and seed, and every part can be re-rolled on its own.
import { mulberry32, pick, weighted } from './audio/rng.js';
import { SCALES, numberRowChords, spiceChords, snapToKey } from './theory.js';
import { newPattern, newChannel, PATTERN_COLORS, uid } from './state.js';
import { SOUNDS } from './audio/soundbank.js';
import { PRESETS as SEAL_PRESETS } from './plugins/seal.js';

// --- styles -----------------------------------------------------------------------
// drums: grid strings, one char per 16th ('x' hit, 'o' ghost, '.' rest) over one bar.
// Lists give alternatives; the seed picks one per song.

export const STYLES = {
  drill: { label: 'Drill', bpm: [140, 146], scale: ['Minor', 'Harmonic Minor', 'Phrygian'], swing: 0, bass: '808s', chords: ['Keys', 'Vox/Choir', 'Pads'], lead: ['Bells', 'Plucks', 'Leads'], density: 0.5, chordRhythm: 'stabs', seal: 'Drill Night', algo: 'astral' },
  trap: { label: 'Trap', bpm: [130, 160], scale: ['Minor', 'Harmonic Minor'], swing: 0.08, bass: '808s', chords: ['Pads', 'Keys'], lead: ['Bells', 'Plucks'], density: 0.45, chordRhythm: 'held', seal: 'Drill Night', algo: 'plate' },
  rage: { label: 'Rage', bpm: [150, 165], scale: ['Minor', 'Phrygian'], swing: 0, bass: '808s', chords: ['Leads', 'Pads'], lead: ['Leads'], density: 0.6, chordRhythm: 'pulse', seal: 'Anthem', algo: 'void' },
  phonk: { label: 'Phonk', bpm: [130, 145], scale: ['Phrygian', 'Minor'], swing: 0.05, bass: '808s', chords: ['Vox/Choir', 'Pads'], lead: ['Percussion:cowbell'], density: 0.55, chordRhythm: 'held', seal: 'Drill Night', algo: 'temple' },
  boombap: { label: 'Boom Bap', bpm: [86, 95], scale: ['Dorian', 'Minor'], swing: 0.35, bass: 'Bass', chords: ['Keys'], lead: ['Keys', 'Bells'], density: 0.35, chordRhythm: 'held', seal: 'Transparent', algo: 'velvet' },
  lofi: { label: 'Lo-fi', bpm: [72, 88], scale: ['Dorian', 'Major', 'Minor'], swing: 0.45, bass: 'Bass', chords: ['Keys'], lead: ['Plucks', 'Bells', 'Keys'], density: 0.35, chordRhythm: 'held', seal: 'Transparent', algo: 'velvet' },
  house: { label: 'House', bpm: [120, 126], scale: ['Minor', 'Dorian', 'Major'], swing: 0.1, bass: 'Bass', chords: ['Keys', 'Pads'], lead: ['Plucks', 'Leads'], density: 0.45, chordRhythm: 'offbeat', seal: 'Anthem', algo: 'plate' },
  afrobeats: { label: 'Afrobeats', bpm: [100, 112], scale: ['Major', 'Mixolydian', 'Dorian'], swing: 0.18, bass: 'Bass', chords: ['Keys', 'Plucks'], lead: ['Plucks', 'Bells', 'Leads'], density: 0.5, chordRhythm: 'skank', seal: '9990 Good Ending', algo: 'plate' },
  amapiano: { label: 'Amapiano', bpm: [110, 115], scale: ['Minor', 'Dorian'], swing: 0.22, bass: 'Percussion:logdrum', chords: ['Keys'], lead: ['Keys', 'Bells', 'Plucks'], density: 0.4, chordRhythm: 'skank', seal: '9990 Good Ending', algo: 'velvet' },
  jerseyclub: { label: 'Jersey Club', bpm: [138, 145], scale: ['Minor', 'Major'], swing: 0, bass: '808s', chords: ['Pads', 'Vox/Choir'], lead: ['Plucks', 'Bells'], density: 0.5, chordRhythm: 'held', seal: 'Anthem', algo: 'plate' },
  reggaeton: { label: 'Reggaeton', bpm: [90, 98], scale: ['Minor', 'Harmonic Minor'], swing: 0, bass: 'Bass', chords: ['Keys', 'Plucks'], lead: ['Leads', 'Plucks'], density: 0.5, chordRhythm: 'skank', seal: 'Anthem', algo: 'plate' },
  anthem: { label: 'Anthem', bpm: [120, 132], scale: ['Major', 'Mixolydian', 'Minor'], swing: 0, bass: 'Bass', chords: ['Pads', 'Vox/Choir'], lead: ['Leads', 'Bells'], density: 0.4, chordRhythm: 'held', seal: 'Anthem', algo: 'cathedral' },
  cinematic: { label: 'Cinematic', bpm: [80, 100], scale: ['Minor', 'Harmonic Minor', 'Lydian'], swing: 0, bass: 'Bass', chords: ['Pads', 'Vox/Choir'], lead: ['Leads', 'Bells'], density: 0.3, chordRhythm: 'held', seal: '9990 Good Ending', algo: 'cathedral' },
  ambient: { label: 'Ambient', bpm: [60, 80], scale: ['Lydian', 'Major', 'Minor'], swing: 0, bass: 'Bass', chords: ['Pads', 'Textures'], lead: ['Bells', 'Plucks'], density: 0.25, chordRhythm: 'held', seal: 'Stream Safe', algo: 'shimmer' },
};

const GRIDS = {
  drill: { kick: ['x.....x...x.....', 'x......x..x...x.', 'x.....x....x....'], snare: ['........x.......', '........x......o', '........x....x..'], perc: ['.......x....x...', '...x......x.....'] },
  trap: { kick: ['x......x..x.....', 'x.......x.x.....', 'x..x......x....x'], snare: ['........x.......'], perc: ['......x.......x.'] },
  rage: { kick: ['x.x.....x.x.x...', 'x...x.x...x.....'], snare: ['........x.......'], perc: ['....x.......x...'] },
  phonk: { kick: ['x.....x...x.....', 'x.x.......x..x..'], snare: ['....x.......x...'], perc: [] },
  boombap: { kick: ['x......x..x.....', 'x.x.......x..x..', 'x......x.x......'], snare: ['....x.......x...', '....x.......x..o'], perc: ['..............x.'] },
  lofi: { kick: ['x......x..x.....', 'x.......x.x.....'], snare: ['....x.......x...'], perc: [] },
  house: { kick: ['x...x...x...x...'], snare: ['....x.......x...'], perc: ['..x...x...x...x.'] },
  afrobeats: { kick: ['x..x..x...x..x..', 'x.....x...x..x..'], snare: ['...x..x....x..x.', '......x.......x.'], perc: ['x..x..x..x..x.x.'] },
  amapiano: { kick: ['x...x...x...x...', 'x.......x.......'], snare: ['....x.......x...'], perc: ['x..x..x.x..x..x.', '..x..x....x..x..'] },
  jerseyclub: { kick: ['x..x..x.x..x..x.', 'x..x..x.x.x.x...'], snare: ['....x.......x...', '....x..x....x...'], perc: ['..............xx'] },
  reggaeton: { kick: ['x...x...x...x...'], snare: ['...x..x....x..x.'], perc: ['..x...x...x...x.'] },
  anthem: { kick: ['x...x...x...x...', 'x.......x.x.....'], snare: ['....x.......x...'], perc: ['..............xx'] },
  cinematic: { kick: ['x.....x.x.......', 'x.........x.....'], snare: ['............x...'], perc: ['x.....x.x...x.x.'] },
  ambient: { kick: ['x...............'], snare: [], perc: ['..x.......x.....'] },
};

// --- vibe words ------------------------------------------------------------------
// "dark rainy drill for a storytime video" -> style + mood knobs.

const MOODS = {
  dark: { scales: ['Phrygian', 'Harmonic Minor', 'Minor'], algo: 'cathedral', energy: 0, register: -1 },
  spooky: { scales: ['Hijaz (Phrygian Dominant)', 'Phrygian'], algo: 'void', energy: 0, register: -1, choir: true },
  sad: { scales: ['Minor', 'Dorian'], algo: 'velvet', energy: -1, register: 0 },
  happy: { scales: ['Major', 'Mixolydian'], algo: 'plate', energy: 1, register: 1 },
  dreamy: { scales: ['Lydian', 'Major'], algo: 'shimmer', energy: -1, register: 1 },
  epic: { scales: ['Minor', 'Harmonic Minor'], algo: 'cathedral', energy: 1, register: 0, choir: true },
  aggressive: { scales: ['Phrygian', 'Minor'], algo: 'gated', energy: 2, register: -1 },
  chill: { scales: ['Dorian', 'Major'], algo: 'velvet', energy: -1, register: 0 },
  triumphant: { scales: ['Major', 'Mixolydian'], algo: 'cathedral', energy: 1, register: 0, choir: true },
};
const MOOD_WORDS = {
  dark: ['dark', 'night', 'evil', 'grim', 'shadow', 'cold', 'gritty', 'street', 'menacing'],
  spooky: ['spooky', 'creepy', 'haunted', 'horror', 'eerie', 'ghost', 'occult', 'ritual', 'witch'],
  sad: ['sad', 'emotional', 'heartbreak', 'cry', 'rain', 'rainy', 'lonely', 'pain', 'melancholy'],
  happy: ['happy', 'fun', 'summer', 'sunny', 'bright', 'upbeat', 'party', 'joy', 'cute'],
  dreamy: ['dreamy', 'space', 'astral', 'floaty', 'ethereal', 'heaven', 'cloud', 'stars', 'cosmic'],
  epic: ['epic', 'huge', 'cinematic', 'trailer', 'battle', 'hero', 'war', 'boss'],
  aggressive: ['aggressive', 'hard', 'angry', 'rage', 'mosh', 'gym', 'intense', 'distorted'],
  chill: ['chill', 'relax', 'study', 'calm', 'soft', 'mellow', 'lazy', 'cozy', 'vibe'],
  triumphant: ['triumphant', 'victory', 'win', 'anthem', 'stadium', 'good ending', 'hope', 'uplifting'],
};
const STYLE_WORDS = {
  drill: ['drill', 'uk', 'ny drill', 'bronx', 'chicago'], trap: ['trap', 'atlanta'], rage: ['rage', 'opium', 'hyper'],
  phonk: ['phonk', 'memphis', 'drift', 'cowbell'], boombap: ['boom bap', 'boombap', '90s', 'old school', 'golden era'],
  lofi: ['lofi', 'lo-fi', 'study'], house: ['house', 'club', 'dance', 'edm', 'techno'], afrobeats: ['afro', 'afrobeat', 'afrobeats', 'afroswing'],
  amapiano: ['amapiano', 'piano', 'log drum'], jerseyclub: ['jersey', 'jersey club', 'bounce'], reggaeton: ['reggaeton', 'dembow', 'latin', 'perreo'],
  anthem: ['anthem', 'stadium', 'arena'], cinematic: ['cinematic', 'trailer', 'film', 'score', 'orchestral', 'documentary'],
  ambient: ['ambient', 'drone', 'meditation', 'background', 'sleep'],
};

export function readVibe(text = '', fallbackStyle = null, rng = Math.random) {
  const t = ' ' + String(text).toLowerCase() + ' ';
  let style = fallbackStyle, mood = null, best = 0;
  for (const [s, words] of Object.entries(STYLE_WORDS)) {
    const hits = words.filter(w => t.includes(w)).length;
    if (hits > best) { best = hits; style = s; }
  }
  best = 0;
  for (const [m, words] of Object.entries(MOOD_WORDS)) {
    const hits = words.filter(w => t.includes(w)).length;
    if (hits > best) { best = hits; mood = m; }
  }
  if (!style) style = mood === 'epic' || mood === 'triumphant' ? 'anthem' : mood === 'chill' ? 'lofi' : mood === 'dreamy' ? 'ambient' : mood === 'aggressive' ? 'rage' : mood === 'spooky' ? 'phonk' : pick(rng, Object.keys(STYLES));
  const length = /\b(short|quick|loop|30 ?s)/.test(t) ? 'short' : /\b(long|extended|full)/.test(t) ? 'long' : 'normal';
  return { style, mood, length };
}

// --- sounds ------------------------------------------------------------------------

function soundFor(spec, rng, mood) {
  let [cat, kind] = spec.split(':');
  let pool = SOUNDS.filter(s => s.category === cat && (!kind || s.tags.includes(kind)));
  if (!pool.length) pool = SOUNDS.filter(s => s.category === cat);
  // moods lean the choice: dark/aggressive prefer drill/distorted tags, dreamy prefers airy
  if (mood && pool.length > 2) {
    const want = { dark: ['drill', 'dist', 'gritty'], aggressive: ['dist', 'gritty', 'drill'], dreamy: ['airy', 'shimmer', 'chime'], spooky: ['choir', 'gong'] }[mood];
    const leaning = want ? pool.filter(s => s.tags.some(t => want.includes(t))) : [];
    if (leaning.length && rng() < 0.6) pool = leaning;
  }
  return pool[Math.floor(rng() * pool.length)].id;
}
export const pickSound = (cat, rng = Math.random) => soundFor(cat, rng);

// --- drums -------------------------------------------------------------------------

const toHits = (grid, o) => [...grid].map((c, i) => (c === 'x' ? { t: o + i, v: 0.9 } : c === 'o' ? { t: o + i, v: 0.45 } : null)).filter(Boolean);

// Returns note lists per drum role for `bars` bars. opts.fill puts a fill in the
// last bar; opts.stop drops kick+808 for the last two beats (the drill "stop").
export function drums(style, rng, bars = 4, opts = {}) {
  const G = GRIDS[style] || GRIDS.trap;
  const kickG = pick(rng, G.kick), snareG = G.snare.length ? pick(rng, G.snare) : null, percG = G.perc.length ? pick(rng, G.perc) : null;
  const out = { len: bars * 16, kick: [], snare: [], hat: [], perc: [], ohat: [], shaker: [] };
  const energy = opts.energy ?? 0;
  for (let b = 0; b < bars; b++) {
    const o = b * 16, last = b === bars - 1;
    let k = toHits(kickG, o);
    if (b % 2 === 1 && rng() < 0.4) k = k.map(h => (h.t % 16 > 8 && rng() < 0.5 ? { ...h, t: h.t + 1 } : h)); // small variation on even bars
    out.kick.push(...k);
    if (snareG) out.snare.push(...toHits(snareG, o));
    if (percG) out.perc.push(...toHits(percG, o).map(h => ({ ...h, v: 0.7 })));
    // hats by style
    if (['drill', 'trap', 'rage', 'jerseyclub', 'phonk'].includes(style)) {
      const rollP = style === 'trap' || style === 'rage' ? 0.14 : 0.1 + energy * 0.04;
      const step = style === 'drill' || style === 'phonk' ? 2 : 1;
      for (let s = 0; s < 16; s += step) {
        if (rng() < rollP) { const n = pick(rng, [3, 4, 6]); for (let r = 0; r < n; r++) out.hat.push({ t: o + s + r * (step / n), v: 0.55 + r * 0.06 }); }
        else out.hat.push({ t: o + s + (style === 'drill' && s % 4 === 2 && rng() < 0.25 ? 1 : 0), v: s % 4 ? 0.55 : 0.8 });
      }
    } else if (style === 'house' || style === 'anthem') {
      for (let s = 0; s < 16; s += 2) (s % 4 === 2 ? out.ohat : out.hat).push({ t: o + s, v: s % 4 === 2 ? 0.7 : 0.5 });
      if (style === 'house') for (let s = 0; s < 16; s++) out.shaker.push({ t: o + s, v: 0.3 + (s % 2 ? 0 : 0.15) });
    } else if (['afrobeats', 'amapiano', 'reggaeton'].includes(style)) {
      for (let s = 0; s < 16; s++) out.shaker.push({ t: o + s, v: s % 4 === 0 ? 0.65 : 0.35 + rng() * 0.15 });
      for (let s = 2; s < 16; s += 4) out.hat.push({ t: o + s, v: 0.5 });
    } else if (style === 'cinematic' || style === 'ambient') {
      if (style === 'cinematic' && b % 2 === 1) for (let s = 0; s < 16; s += 4) out.hat.push({ t: o + s + 2, v: 0.35 });
    } else { // boombap, lofi
      for (let s = 0; s < 16; s += 2) out.hat.push({ t: o + s, v: 0.4 + rng() * 0.3 + (s % 4 === 0 ? 0.1 : 0) });
    }
    if (last && opts.fill) {
      out.snare = out.snare.filter(h => h.t < o + 12);
      if (style === 'drill' || style === 'trap' || style === 'rage') for (let r = 0; r < 8; r++) out.snare.push({ t: o + 12 + r * 0.5, v: 0.45 + r * 0.07 });
      else for (const s of [12, 13, 14, 15]) out.snare.push({ t: o + s, v: 0.5 + (s - 12) * 0.12 });
    }
    if (last && opts.stop) {
      out.kick = out.kick.filter(h => h.t < o + 8);
      out.hat = out.hat.filter(h => h.t < o + 12);
    }
  }
  const N = (arr, d = 1) => arr.map(h => ({ t: h.t, d, m: 60, v: h.v }));
  return { len: out.len, kick: N(out.kick), snare: N(out.snare), hat: N(out.hat, 0.5), perc: N(out.perc), ohat: N(out.ohat, 2), shaker: N(out.shaker, 0.5) };
}

// --- harmony --------------------------------------------------------------------------

const SHAPES = {
  minor: [[0, 2, 5, 0], [0, 4, 2, 5], [0, 1, 2, 5], [0, 7, 1, 5], [0, 2, 3, 4], [0, 1, 7, 4], [0, 0, 2, 4]],
  major: [[0, 2, 1, 3], [0, 3, 2, 1], [4, 1, 0, 3], [0, 1, 2, 3], [0, 6, 1, 3], [0, 2, 7, 3], [0, 4, 1, 3]],
};

export function progression(key, style, rng, bars = 4) {
  const row = numberRowChords(key);
  const minorish = SCALES[key.scale].includes(3) && !SCALES[key.scale].includes(4);
  const shape = pick(rng, SHAPES[minorish ? 'minor' : 'major']);
  const chords = [];
  for (let b = 0; b < bars; b++) {
    let c = row[shape[b % shape.length]];
    if (rng() < 0.1) c = pick(rng, spiceChords(key)); // a little Murmur in every roll
    chords.push(c);
  }
  return chords;
}

export function chordNotes(chords, style, rng, rhythm = STYLES[style]?.chordRhythm || 'held') {
  const notes = [];
  chords.forEach((c, b) => {
    const o = b * 16;
    if (rhythm === 'held') for (const m of c.notes) notes.push({ t: o, d: 16, m, v: 0.6 });
    else if (rhythm === 'offbeat') for (const s of [2, 6, 10, 14]) for (const m of c.notes) notes.push({ t: o + s, d: 1.5, m, v: 0.55 });
    else if (rhythm === 'skank') for (const s of pick(rng, [[0, 3, 6, 10, 13], [2, 6, 10, 14], [0, 6, 8, 14]])) for (const m of c.notes) notes.push({ t: o + s, d: 1.5, m, v: 0.55 });
    else if (rhythm === 'pulse') for (let s = 0; s < 16; s += 2) for (const m of c.notes) notes.push({ t: o + s, d: 1.6, m: m + 12, v: s % 4 ? 0.45 : 0.6 });
    else {
      const hits = pick(rng, [[0, 6, 12], [0, 10], [0, 3, 8, 11], [0]]);
      hits.forEach((h, i) => {
        const d = (hits[i + 1] ?? 16) - h;
        for (const m of c.notes) notes.push({ t: o + h, d: Math.max(2, d - 1), m, v: 0.55 });
      });
    }
  });
  return notes;
}

// is808: the 808s and log drums in the sound bank sound their base pitch at MIDI 60,
// so their lines sit two octaves up from a normal bass line.
export function bassline(chords, kicks, style, rng, is808 = false) {
  const notes = [];
  const kickT = kicks.map(k => k.t).sort((a, b) => a - b);
  chords.forEach((c, b) => {
    const root = Math.min(...c.notes) % 12 + 36 + (is808 ? 24 : 0);
    const o = b * 16;
    let hits;
    if (style === 'anthem' || style === 'ambient' || style === 'cinematic') hits = [o];
    else if (style === 'house') hits = [o + 2, o + 6, o + 10, o + 14];
    else if (style === 'amapiano') hits = pick(rng, [[0, 3, 7, 10, 14], [0, 6, 8, 11, 14]]).map(s => o + s);
    else hits = kickT.filter(t => t >= o && t < o + 16);
    if (!hits.length) hits.push(o);
    hits.forEach((t, i) => {
      const next = hits[i + 1] ?? o + 16;
      let m = root;
      if ((style === 'drill' || style === 'trap' || style === 'rage') && rng() < 0.3) m = root + pick(rng, [12, 7, -2, 3]); // slides
      if (style === 'amapiano' && i % 2 === 1) m = root + pick(rng, [7, 12, 10]);
      notes.push({ t, d: Math.max(1, Math.min(next - t, style === 'house' ? 1.5 : 16)), m, v: 0.9 });
    });
  });
  return notes;
}

// Call and response: bar 1 states a motif, bar 2 answers, bar 3 restates with a
// twist, bar 4 cadences onto a chord tone. Strong beats land on chord tones.
export function melody(key, chords, rng, { density = 0.45, octave = 5 } = {}) {
  const sc = SCALES[key.scale];
  const base = 12 * (octave + 1) + key.root;
  const toMidi = deg => base + sc[((deg % sc.length) + sc.length) % sc.length] + 12 * Math.floor(deg / sc.length);
  const motif = start => {
    const out = [];
    let deg = start;
    for (let s = 0; s < 16;) {
      const d = weighted(rng, [[1, 2], [2, 4], [3, 2], [4, 1.5], [6, 0.6]]);
      if (rng() < density || s === 0) out.push({ s, d, deg });
      deg += weighted(rng, [[1, 3], [-1, 3], [2, 1.5], [-2, 1.5], [0, 1], [4, 0.4], [-3, 0.4]]);
      deg = Math.max(-3, Math.min(9, deg));
      s += d;
    }
    return out;
  };
  const call = motif(pick(rng, [0, 2, 4])), answer = motif(pick(rng, [4, 5, 2]));
  const notes = [];
  chords.forEach((c, b) => {
    const pcs = c.notes.map(n => n % 12);
    const phrase = b % 4 === 1 ? answer : call;
    const twist = b % 4 === 2, cadence = b % 4 === 3;
    phrase.forEach((n, i) => {
      if (cadence && n.s >= 8) return;
      let m = toMidi(n.deg + (twist && i === phrase.length - 1 ? pick(rng, [1, -1, 2]) : 0));
      if (n.s % 4 === 0 && !pcs.includes(m % 12)) {
        for (let k = 1; k < 3; k++) { if (pcs.includes((m + k) % 12)) { m += k; break; } if (pcs.includes((m - k + 12) % 12)) { m -= k; break; } }
      }
      notes.push({ t: b * 16 + n.s, d: Math.min(n.d, 16 - n.s), m, v: 0.75 + rng() * 0.15 });
    });
    if (cadence) { // land on the nearest chord tone and hold it
      const target = c.notes.map(x => x % 12);
      let m = toMidi(0);
      for (let k = 0; k < 6; k++) { if (target.includes((m + k) % 12)) { m += k; break; } }
      notes.push({ t: b * 16 + 8, d: 8, m, v: 0.8 });
    }
  });
  return notes;
}

// A third below the melody, in key: instant hook harmony.
export function harmonize(notes, key) {
  const sc = SCALES[key.scale];
  return notes.map(n => {
    let m = n.m - 3;
    if (!sc.includes((((m - key.root) % 12) + 12) % 12)) m = n.m - 4;
    return { ...n, m: snapToKey(m, key), v: (n.v ?? 0.8) * 0.75 };
  });
}

// --- the song ---------------------------------------------------------------------------

export const LANE_ROLES = ['Drums', '808 / Bass', 'Chords', 'Melody', 'Counter melody', 'Pad'];

const FORMS = {
  short: [['Intro', 1], ['Hook', 2], ['Verse', 2], ['Hook', 2], ['Outro', 1]],
  normal: [['Intro', 1], ['Hook', 2], ['Verse', 2], ['Pre', 1], ['Hook', 2], ['Bridge', 1], ['Hook', 2], ['Outro', 1]],
  long: [['Intro', 1], ['Hook', 2], ['Verse', 4], ['Pre', 1], ['Hook', 2], ['Verse', 2], ['Bridge', 2], ['Pre', 1], ['Hook', 2], ['Outro', 1]],
};
// which roles play in each section
const SECTION_PARTS = {
  Intro: ['chords', 'pad', 'melody', 'hat'],
  Verse: ['drums', 'bass', 'chords', 'counter'],
  Pre: ['drums', 'bass', 'chords', 'pad', 'fill'],
  Hook: ['drums', 'bass', 'chords', 'melody', 'harmony', 'counter', 'pad', 'perc', 'choir'],
  Bridge: ['bass', 'pad', 'counter', 'chords', 'perc'],
  Outro: ['chords', 'pad', 'melody'],
};

const roleName = { kick: 'Kick', snare: 'Snare', hat: 'Hat', ohat: 'Open Hat', shaker: 'Shaker', perc: 'Perc', bass: '808', chords: 'Chords', melody: 'Melody', counter: 'Counter', pad: 'Pad', choir: 'Choir', fx: 'FX' };

// opts: style, seed, vibe (free text), length, lanes (MIDI Mashup), split (one track per instrument), mix (auto FX)
export function buildSong(project, opts = {}) {
  const seed = opts.seed ?? 9990;
  const rng = mulberry32(seed);
  const vibe = readVibe(opts.vibe || '', opts.style || null, rng);
  const style = STYLES[opts.style] ? opts.style : vibe.style;
  const mood = vibe.mood ? MOODS[vibe.mood] : null;
  const st = STYLES[style];
  const length = opts.length || vibe.length || 'normal';

  const energy = mood ? mood.energy : 0;
  project.bpm = Math.round(st.bpm[0] + rng() * (st.bpm[1] - st.bpm[0]) + (energy > 0 && st.bpm[1] > 100 ? 2 * energy : 0));
  project.swing = st.swing;
  project.key = { root: Math.floor(rng() * 12), scale: pick(rng, mood ? mood.scales : st.scale) };
  project.seed = seed;

  // --- channels: one per role -------------------------------------------------------
  project.channels = [];
  const roles = {}; // role -> channel
  let mix = 1;
  const add = (role, source, name) => {
    const c = newChannel(name || roleName[role], source, mix++);
    project.channels.push(c); roles[role] = c; return c;
  };
  const snd = (spec) => ({ type: 'sound', soundId: soundFor(spec, rng, vibe.mood) });
  const lanes = opts.lanes || null;
  const laneSrc = role => lanes?.find(l => l.role === role);
  const wantLane = role => !lanes || lanes.some(l => l.role === role);

  if (wantLane('Drums')) {
    add('kick', snd('Kicks'));
    add('snare', snd(style === 'house' || style === 'anthem' || style === 'reggaeton' ? 'Claps' : 'Snares'), style === 'house' ? 'Clap' : 'Snare');
    add('hat', snd('Hats'));
    if (['house', 'anthem'].includes(style)) add('ohat', { type: 'sound', soundId: SOUNDS.find(s => s.category === 'Hats' && s.tags.includes('open'))?.id || soundFor('Hats', rng) });
    if (['house', 'afrobeats', 'amapiano', 'reggaeton'].includes(style)) add('shaker', snd('Percussion:shaker'));
    const percKind = { afrobeats: 'conga', amapiano: 'clave', reggaeton: 'rim', cinematic: 'tom', drill: 'rim', jerseyclub: 'snap', boombap: 'rim' }[style];
    add('perc', snd(percKind ? `Percussion:${percKind}` : 'Percussion'));
  }
  if (wantLane('808 / Bass')) add('bass', laneSrc('808 / Bass')?.source || snd(st.bass), st.bass.startsWith('Perc') ? 'Log Drum' : st.bass === '808s' ? '808' : 'Bass');
  if (wantLane('Chords')) add('chords', laneSrc('Chords')?.source || snd(pick(rng, st.chords)));
  if (wantLane('Melody')) add('melody', laneSrc('Melody')?.source || snd(pick(rng, st.lead)));
  if (wantLane('Counter melody')) add('counter', laneSrc('Counter melody')?.source || snd(pick(rng, ['Bells', 'Plucks', 'Keys'])));
  if (wantLane('Pad')) add('pad', laneSrc('Pad')?.source || snd(style === 'ambient' ? 'Textures' : 'Pads'));
  if (!lanes && (mood?.choir || style === 'anthem' || style === 'cinematic')) add('choir', snd('Vox/Choir'));
  add('fx', snd('FX:riser'), 'Riser');
  const impact = add('impact', snd('FX:impact'), 'Impact');

  const is808 = c => c && c.source.type === 'sound' && /^(808|perc)-/.test(c.source.soundId || '');
  const register = mood?.register || 0;

  // --- material ---------------------------------------------------------------------------
  const chords = progression(project.key, style, rng);
  // pitched percussion (phonk cowbell) sounds its base pitch at MIDI 60, so it plays an octave down
  const leadOct = roles.melody && /^perc-/.test(roles.melody.source.soundId || '') ? 4 : 5 + (register > 0 ? 1 : 0);
  const hookMel = melody(project.key, chords, rng, { density: st.density, octave: leadOct });
  const verseCounter = melody(project.key, chords, rng, { density: st.density * 0.45, octave: 5 + register });
  const parts = {
    chords: chordNotes(chords, style, rng),
    melody: hookMel,
    harmony: harmonize(hookMel, project.key),
    counter: verseCounter,
    pad: chords.flatMap((c, b) => c.notes.map(m => ({ t: b * 16, d: 16, m: m - 12, v: 0.4 }))),
    choir: chords.flatMap((c, b) => c.notes.slice(0, 3).map(m => ({ t: b * 16, d: 16, m, v: 0.45 }))),
  };

  const sections = {};
  const sectionPattern = (name, i) => {
    const p = newPattern(name, PATTERN_COLORS[i % PATTERN_COLORS.length], 64);
    const want = SECTION_PARTS[name];
    const put = (role, notes) => { const c = roles[role]; if (c && notes.length) p.notes[c.id] = notes.map(n => ({ ...n })); };
    if (want.includes('drums') || want.includes('fill')) {
      const d = drums(style, rng, 4, { fill: name === 'Pre' || name === 'Verse', stop: style === 'drill' && name === 'Pre', energy });
      const sparse = name === 'Verse';
      put('kick', d.kick); put('snare', d.snare);
      put('hat', sparse ? d.hat.filter(h => Number.isInteger(h.t)) : d.hat);
      put('ohat', d.ohat); put('shaker', d.shaker);
      if (!sparse) put('perc', d.perc);
      if (want.includes('bass') && roles.bass) put('bass', bassline(chords, d.kick, style, rng, is808(roles.bass)).filter(n => !(name === 'Pre' && style === 'drill' && n.t >= 56)));
    } else if (want.includes('bass') && roles.bass) {
      put('bass', chords.map((c, b) => ({ t: b * 16, d: 16, m: Math.min(...c.notes) % 12 + 36 + (is808(roles.bass) ? 24 : 0), v: 0.8 })));
    }
    if (want.includes('hat') && name === 'Intro') put('hat', drums(style, rng, 4).hat.filter(h => h.t >= 32));
    if (want.includes('perc') && name === 'Bridge') put('perc', drums(style, rng, 4).perc);
    if (want.includes('chords')) put('chords', name === 'Intro' || name === 'Outro' ? chordNotes(chords, style, rng, 'held') : parts.chords);
    if (want.includes('melody')) put('melody', name === 'Intro' ? parts.melody.filter(n => n.t < 32) : parts.melody);
    if (want.includes('harmony') && roles.counter && rng() < 0.5) put('counter', parts.harmony);
    else if (want.includes('counter')) put('counter', parts.counter);
    if (want.includes('pad')) put('pad', parts.pad);
    if (want.includes('choir')) put('choir', parts.choir);
    return p;
  };
  const names = ['Intro', 'Verse', 'Pre', 'Hook', 'Bridge', 'Outro'];
  project.patterns = names.map((n, i) => (sections[n] = sectionPattern(n, i)));
  // transitions: a riser into every hook, an impact on its downbeat
  const riser = newPattern('Riser', '#ffd78a', 16), boom = newPattern('Impact', '#ff9a8a', 16);
  riser.notes[roles.fx.id] = [{ t: 0, d: 16, m: 60, v: 0.75 }];
  boom.notes[impact.id] = [{ t: 0, d: 4, m: 60, v: 0.9 }];
  project.patterns.push(riser, boom);
  project.currentPattern = sections.Hook.id;
  project.selectedChannel = (roles.melody || project.channels[0]).id;

  // --- arrangement --------------------------------------------------------------------------
  const form = FORMS[length];
  project.arrangement.clips = [];
  project.arrangement.tracks = names.map((n, i) => ({ id: i + 1, name: n, mixer: 0, mute: false }));
  project.arrangement.tracks.push({ id: 7, name: 'Transitions', mixer: 0, mute: false });
  for (let i = 8; i <= 12; i++) project.arrangement.tracks.push({ id: i, name: `Track ${i}`, mixer: 0, mute: false });
  let at = 0;
  for (const [name, reps] of form) {
    const p = sections[name];
    if (name === 'Hook' && at >= 16) {
      project.arrangement.clips.push({ id: uid('cl'), type: 'pattern', patternId: riser.id, track: 7, start: at - 16, length: 16 });
      project.arrangement.clips.push({ id: uid('cl'), type: 'pattern', patternId: boom.id, track: 7, start: at, length: 16 });
    }
    project.arrangement.clips.push({ id: uid('cl'), type: 'pattern', patternId: p.id, track: names.indexOf(name) + 1, start: at, length: 64 * reps });
    at += 64 * reps;
  }
  // unused sections out of the pattern list
  const used = new Set(project.arrangement.clips.map(c => c.patternId));
  project.patterns = project.patterns.filter(p => used.has(p.id) || p === sections.Hook);

  // --- mix ----------------------------------------------------------------------------------
  if (opts.mix !== false) autoMix(project, roles, style, mood);

  project.gen = { style, mood: vibe.mood, seed, length, roles: Object.fromEntries(Object.entries(roles).map(([r, c]) => [r, c.id])) };
  project.name = `${pick(rng, ['Sigil', 'Ninth Gate', 'Emerald', 'Saturn', 'Good Ending', 'Astral', 'Hermes', 'Lantern', '9990', 'Wellspring', 'Oracle', 'Mercury'])} ${pick(rng, ['Anthem', 'Run', 'Ritual', 'Signal', 'Return', 'Transmission', 'Path', 'Tide', 'Psalm', 'Circuit'])}`;

  if (opts.split) splitAll(project);
  return { style, mood: vibe.mood, length, project };
}

// Reverb on the melodic parts, a delay on the lead, Halo on the low end, Seal on the master.
export function autoMix(project, roles, style, mood) {
  const st = STYLES[style];
  const algo = mood?.algo || st.algo;
  const trackOf = c => project.mixer.tracks.find(t => t.id === c.mixer);
  const fx = (role, list) => { const c = roles[role]; const t = c && trackOf(c); if (t) { t.name = c.name; t.fx = list; } };
  const verb = (mix, decay) => ({ pluginId: 'abyss', state: { algorithm: algo, mix, decay }, bypass: false });
  fx('melody', [verb(0.22, 2.4), { pluginId: 'ouroboros', state: { sync: '1/8D', mix: 0.16, feedback: 0.35 }, bypass: false }]);
  fx('counter', [verb(0.28, 3)]);
  fx('chords', [verb(0.2, 2.2)]);
  fx('pad', [verb(0.35, 4.5)]);
  fx('choir', [verb(0.4, 5)]);
  fx('fx', [verb(0.3, 3)]);
  fx('bass', [{ pluginId: 'halo', state: { amount: 45, flavor: 'warm' }, bypass: false }]);
  fx('snare', [verb(0.12, 1.2)]);
  for (const r of ['kick', 'hat', 'ohat', 'shaker', 'perc', 'impact']) { const c = roles[r]; const t = c && trackOf(c); if (t) t.name = c.name; }
  const preset = SEAL_PRESETS.find(p => p.name === st.seal) || SEAL_PRESETS[0];
  project.mixer.master.fx = [{ pluginId: 'seal', state: { ...preset.params, preset: preset.name, bypass: false }, bypass: false }];
}

// Split every pattern by instrument; the playlist gets one track per instrument.
export function splitAll(project) {
  const order = project.channels;
  const tracks = order.map((c, i) => ({ id: i + 1, name: c.name, mixer: 0, mute: false }));
  const clips = [];
  const newPatterns = [];
  const made = new Map(); // patternId -> [{ch, np}]
  for (const p of project.patterns) {
    const per = [];
    for (const c of order) {
      const notes = p.notes[c.id], steps = p.steps[c.id];
      if (!(notes && notes.length) && !(steps && steps.some(Boolean))) continue;
      const np = newPattern(`${p.name} · ${c.name}`, p.color, p.length);
      if (notes) np.notes[c.id] = notes; if (steps) np.steps[c.id] = steps;
      per.push({ c, np }); newPatterns.push(np);
    }
    made.set(p.id, per);
  }
  for (const cl of project.arrangement.clips) {
    for (const { c, np } of made.get(cl.patternId) || []) clips.push({ id: uid('cl'), type: 'pattern', patternId: np.id, track: order.indexOf(c) + 1, start: cl.start, length: cl.length });
  }
  project.patterns = newPatterns.length ? newPatterns : project.patterns;
  project.arrangement.tracks = tracks.length >= 12 ? tracks : [...tracks, ...Array.from({ length: 12 - tracks.length }, (_, i) => ({ id: tracks.length + i + 1, name: `Track ${tracks.length + i + 1}`, mixer: 0, mute: false }))];
  project.arrangement.clips = clips;
  project.currentPattern = (newPatterns.find(p => p.name.startsWith('Hook')) || project.patterns[0]).id;
}

// --- after the box is open -----------------------------------------------------------------

// New melodies and counter lines everywhere, same key, beat and sounds.
export function variation(project, seed = Math.floor(Math.random() * 99990)) {
  const rng = mulberry32(seed);
  const g = project.gen || {};
  const st = STYLES[g.style] || STYLES.drill;
  const mel = g.roles?.melody, ctr = g.roles?.counter;
  const chords = progression(project.key, g.style || 'drill', rng);
  const hook = melody(project.key, chords, rng, { density: st.density });
  const counter = melody(project.key, chords, rng, { density: st.density * 0.45 });
  let n = 0;
  for (const p of project.patterns) {
    if (mel && p.notes[mel]?.length) { p.notes[mel] = p.notes[mel].some(x => x.t >= 32) ? hook.map(x => ({ ...x })) : hook.filter(x => x.t < 32); n++; }
    if (ctr && p.notes[ctr]?.length) { p.notes[ctr] = counter.map(x => ({ ...x })); n++; }
  }
  return n;
}

// Keep the melody and chords, swap the drums and bass for another style.
export function remix(project, style, seed = Math.floor(Math.random() * 99990)) {
  if (!STYLES[style]) return false;
  const rng = mulberry32(seed);
  const g = project.gen || (project.gen = { roles: {} });
  const st = STYLES[style];
  project.bpm = Math.round(st.bpm[0] + rng() * (st.bpm[1] - st.bpm[0]));
  project.swing = st.swing;
  const R = g.roles || {};
  const chords = progression(project.key, style, rng);
  for (const p of project.patterns) {
    const hasDrums = ['kick', 'snare', 'hat'].some(r => R[r] && p.notes[R[r]]?.length);
    if (!hasDrums) continue;
    const d = drums(style, rng, p.length / 16, { fill: /Pre|Verse/.test(p.name), stop: style === 'drill' && /Pre/.test(p.name) });
    for (const r of ['kick', 'snare', 'hat', 'perc', 'ohat', 'shaker']) if (R[r] && p.notes[R[r]]) p.notes[R[r]] = d[r] || [];
    if (R.bass && p.notes[R.bass]?.length) {
      const c = project.channels.find(x => x.id === R.bass);
      p.notes[R.bass] = bassline(chords, d.kick, style, rng, c && /^(808|perc)-/.test(c.source.soundId || ''));
    }
  }
  g.style = style;
  return true;
}

// Re-roll one section's notes for one role, or all its melodic roles.
export function rerollPattern(project, patternId, seed = Math.floor(Math.random() * 99990)) {
  const rng = mulberry32(seed);
  const p = project.patterns.find(x => x.id === patternId);
  const g = project.gen || {};
  if (!p) return false;
  const st = STYLES[g.style] || STYLES.drill;
  const chords = progression(project.key, g.style || 'drill', rng, p.length / 16);
  const R = g.roles || {};
  for (const c of project.channels) {
    const notes = p.notes[c.id];
    if (!notes || !notes.length) continue;
    if (c.id === R.melody || c.id === R.counter) p.notes[c.id] = melody(project.key, chords, rng, { density: c.id === R.melody ? st.density : st.density * 0.45 });
    else if (c.id === R.chords) p.notes[c.id] = chordNotes(chords, g.style || 'drill', rng);
    else if (c.id === R.pad) p.notes[c.id] = chords.flatMap((ch, b) => ch.notes.map(m => ({ t: b * 16, d: 16, m: m - 12, v: 0.4 })));
  }
  return true;
}

// Move every note into another scale by scale degree (darker, brighter...).
export function changeScale(project, scale) {
  const from = SCALES[project.key.scale], to = SCALES[scale];
  if (!from || !to || from.length !== 7 || to.length !== 7) { project.key.scale = scale; return; }
  const root = project.key.root;
  const map = m => {
    const rel = m - root, oct = Math.floor(rel / 12), pc = ((rel % 12) + 12) % 12;
    let deg = from.indexOf(pc);
    if (deg < 0) return m;
    return root + oct * 12 + to[deg];
  };
  const drumIds = new Set(project.channels.filter(c => c.source.type === 'sound' && /^(kick|snare|clap|hat|perc|fx)-/.test(c.source.soundId || '')).map(c => c.id));
  for (const p of project.patterns) for (const [cid, notes] of Object.entries(p.notes)) if (!drumIds.has(cid)) for (const n of notes) n.m = map(n.m);
  project.key.scale = scale;
}
