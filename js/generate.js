// Generators for Mystery Box, MIDI Mashup and Murmur's chaos.
// Everything is seeded so a vibe can be re-rolled or reproduced.
import { mulberry32, pick, weighted } from './audio/rng.js';
import { SCALES, numberRowChords, spiceChords } from './theory.js';
import { newPattern, newChannel, PATTERN_COLORS, uid } from './state.js';

export const STYLES = {
  drill: { bpm: [140, 146], scale: ['Minor', 'Harmonic Minor', 'Phrygian'], swing: 0 },
  anthem: { bpm: [120, 132], scale: ['Major', 'Mixolydian', 'Minor'], swing: 0 },
  trap: { bpm: [130, 160], scale: ['Minor', 'Harmonic Minor'], swing: 0.1 },
  lofi: { bpm: [72, 88], scale: ['Dorian', 'Major', 'Minor'], swing: 0.45 },
  ambient: { bpm: [60, 80], scale: ['Lydian', 'Major', 'Minor'], swing: 0 },
};

// --- drums ------------------------------------------------------------------

export function drums(style, rng, bars = 4) {
  const len = bars * 16;
  const kick = [], snare = [], hat = [], perc = [];
  for (let b = 0; b < bars; b++) {
    const o = b * 16;
    if (style === 'drill') {
      snare.push(o + 8);
      if (rng() < 0.35) snare.push(o + (rng() < 0.5 ? 15 : 13));
      kick.push(o);
      for (const s of [3, 6, 10, 11, 14]) if (rng() < 0.4) kick.push(o + s);
      // sliding triplet-ish hats: base 8ths with rolls
      for (let s = 0; s < 16; s += 2) {
        if (rng() < 0.18) for (let k = 0; k < 3; k++) hat.push({ t: o + s + k * (2 / 3), v: 0.6 + k * 0.1 });
        else hat.push({ t: o + s + (s % 4 === 2 && rng() < 0.3 ? 1 : 0), v: s % 4 ? 0.55 : 0.8 });
      }
      if (rng() < 0.5) perc.push(o + 7, o + 12);
    } else if (style === 'trap') {
      kick.push(o); if (rng() < 0.6) kick.push(o + 10); if (rng() < 0.4) kick.push(o + 7);
      snare.push(o + 8);
      for (let s = 0; s < 16; s++) {
        if (rng() < 0.12) { for (let k = 0; k < 4; k++) hat.push({ t: o + s + k * 0.25, v: 0.5 + k * 0.1 }); }
        else hat.push({ t: o + s, v: s % 2 ? 0.5 : 0.75 });
      }
    } else if (style === 'anthem') {
      for (const s of [0, 4, 8, 12]) kick.push(o + s);
      snare.push(o + 4, o + 12);
      for (let s = 2; s < 16; s += 4) hat.push({ t: o + s, v: 0.7 });
      if (b % 2 === 1) perc.push(o + 14, o + 15);
    } else if (style === 'lofi') {
      kick.push(o); if (rng() < 0.7) kick.push(o + 7, o + 10);
      snare.push(o + 4, o + 12);
      for (let s = 0; s < 16; s += 2) hat.push({ t: o + s, v: 0.4 + rng() * 0.3 });
    } else {
      if (b % 2 === 0) kick.push(o);
      for (let s = 0; s < 16; s += 4) if (rng() < 0.5) perc.push(o + s + 2);
    }
  }
  const asNotes = (arr, v = 0.9) => arr.map(x => (typeof x === 'object' ? { t: x.t, d: 0.5, m: 60, v: x.v } : { t: x, d: 1, m: 60, v }));
  return { len, kick: asNotes(kick), snare: asNotes(snare), hat: asNotes(hat), perc: asNotes(perc, 0.7) };
}

// --- harmony ----------------------------------------------------------------

export function progression(key, style, rng, bars = 4) {
  const row = numberRowChords(key);
  const shapes = {
    drill: [[0, 2, 5, 0], [0, 4, 2, 5], [0, 1, 2, 5], [0, 7, 1, 5]],
    anthem: [[0, 2, 1, 3], [0, 3, 2, 1], [4, 1, 0, 3], [0, 1, 2, 3]],
    trap: [[0, 2, 1, 5], [0, 0, 2, 5], [0, 4, 2, 1]],
    lofi: [[4, 3, 0, 2], [0, 5, 4, 3], [1, 3, 0, 8]],
    ambient: [[0, 7, 1, 7], [0, 2, 7, 1]],
  }[style] || [[0, 1, 2, 3]];
  const shape = pick(rng, shapes);
  const chords = [];
  for (let b = 0; b < bars; b++) {
    let c = row[shape[b % shape.length]];
    if (rng() < 0.12) c = pick(rng, spiceChords(key)); // a little Murmur in every roll
    chords.push(c);
  }
  return chords;
}

export function chordNotes(chords, style, rng) {
  const notes = [];
  chords.forEach((c, b) => {
    const o = b * 16;
    if (style === 'lofi' || style === 'ambient' || style === 'anthem') {
      for (const m of c.notes) notes.push({ t: o, d: 16, m, v: 0.6 });
    } else {
      // stabs on the drill/trap pocket
      const hits = pick(rng, [[0, 6, 12], [0, 10], [0, 3, 8, 11], [0]]);
      hits.forEach((h, i) => {
        const d = (hits[i + 1] ?? 16) - h;
        for (const m of c.notes) notes.push({ t: o + h, d: Math.max(2, d - 1), m, v: 0.55 });
      });
    }
  });
  return notes;
}

// is808: the 808s in the sound bank play C2 at MIDI 60, so their lines sit two octaves up
export function bassline(chords, kicks, style, rng, is808 = false) {
  const notes = [];
  const kickT = kicks.map(k => k.t).sort((a, b) => a - b);
  chords.forEach((c, b) => {
    const root = Math.min(...c.notes) % 12 + 36 + (is808 ? 24 : 0); // octave 2-ish
    const o = b * 16;
    const hits = style === 'anthem' || style === 'ambient' ? [o] : kickT.filter(t => t >= o && t < o + 16);
    if (!hits.length) hits.push(o);
    hits.forEach((t, i) => {
      const next = hits[i + 1] ?? o + 16;
      let m = root;
      if (style === 'drill' && rng() < 0.3) m = root + pick(rng, [12, 7, -2, 3]); // slides
      notes.push({ t, d: Math.max(1, next - t), m, v: 0.9 });
    });
  });
  return notes;
}

export function melody(key, chords, rng, { density = 0.45, octave = 5 } = {}) {
  const sc = SCALES[key.scale];
  const base = 12 * (octave + 1) + key.root;
  const toMidi = deg => base + sc[((deg % sc.length) + sc.length) % sc.length] + 12 * Math.floor(deg / sc.length);
  // a one-bar motif, repeated with variation and pulled toward chord tones
  const motif = [];
  let deg = pick(rng, [0, 2, 4]);
  for (let s = 0; s < 16;) {
    const d = weighted(rng, [[1, 2], [2, 4], [3, 2], [4, 1.5], [6, 0.6]]);
    if (rng() < density || s === 0) motif.push({ s, d, deg });
    deg += weighted(rng, [[1, 3], [-1, 3], [2, 1.5], [-2, 1.5], [0, 1], [4, 0.4], [-3, 0.4]]);
    deg = Math.max(-3, Math.min(9, deg));
    s += d;
  }
  const notes = [];
  chords.forEach((c, b) => {
    const pcs = c.notes.map(n => n % 12);
    const vary = b % 2 === 1 ? 1 : (b === chords.length - 1 ? 2 : 0);
    motif.forEach((n, i) => {
      let m = toMidi(n.deg + (vary === 1 && i === motif.length - 1 ? pick(rng, [1, -1, 2]) : 0));
      if (n.s % 4 === 0 && !pcs.includes(m % 12)) {
        // nudge strong beats to the nearest chord tone
        for (let k = 1; k < 3; k++) { if (pcs.includes((m + k) % 12)) { m += k; break; } if (pcs.includes((m - k + 12) % 12)) { m -= k; break; } }
      }
      if (vary === 2 && i === motif.length - 1) return; // leave space at the end of the phrase
      notes.push({ t: b * 16 + n.s, d: Math.min(n.d, 16 - n.s), m, v: 0.75 + rng() * 0.15 });
    });
  });
  return notes;
}

// --- whole songs --------------------------------------------------------------

export const LANE_ROLES = ['Drums', '808 / Bass', 'Chords', 'Melody', 'Counter melody', 'Pad'];

// Builds channels + patterns + arrangement into the project (call inside store.mutate).
// lanes: [{ role, source }] to control instruments (MIDI Mashup); omitted = Murmur picks.
export function buildSong(project, { style = 'drill', seed = 9990, lanes = null, pickSound } = {}) {
  const rng = mulberry32(seed);
  const st = STYLES[style];
  project.bpm = Math.round(st.bpm[0] + rng() * (st.bpm[1] - st.bpm[0]));
  project.swing = st.swing;
  project.key = { root: Math.floor(rng() * 12), scale: pick(rng, st.scale) };
  project.seed = seed;

  const roles = lanes || LANE_ROLES.slice(0, 5).map(role => ({ role, source: null }));
  const ch = {};
  project.channels = [];
  let mix = 1;
  const add = (name, source) => { const c = newChannel(name, source, mix++); project.channels.push(c); return c; };
  for (const lane of roles) {
    if (lane.role === 'Drums') {
      ch.kick = add('Kick', { type: 'sound', soundId: pickSound('Kicks', rng) });
      ch.snare = add('Snare', { type: 'sound', soundId: pickSound(style === 'anthem' ? 'Claps' : 'Snares', rng) });
      ch.hat = add('Hat', { type: 'sound', soundId: pickSound('Hats', rng) });
      ch.perc = add('Perc', { type: 'sound', soundId: pickSound('Percussion', rng) });
    } else {
      const cat = { '808 / Bass': style === 'drill' || style === 'trap' ? '808s' : 'Bass', Chords: style === 'anthem' ? 'Pads' : 'Keys', Melody: pick(rng, ['Leads', 'Plucks', 'Bells']), 'Counter melody': pick(rng, ['Bells', 'Plucks', 'Vox/Choir']), Pad: 'Pads' }[lane.role];
      ch[lane.role] = add(lane.role === '808 / Bass' ? (cat === '808s' ? '808' : 'Bass') : lane.role, lane.source || { type: 'sound', soundId: pickSound(cat, rng) });
    }
  }

  const chords = progression(project.key, style, rng);
  const d = drums(style, rng);
  const parts = {
    chords: chordNotes(chords, style, rng),
    bass: bassline(chords, d.kick, style, rng, style === 'drill' || style === 'trap'),
    melody: melody(project.key, chords, rng, { density: style === 'drill' ? 0.5 : 0.4 }),
    counter: melody(project.key, chords, rng, { density: 0.25, octave: 6 }),
    pad: chords.flatMap((c, b) => c.notes.map(m => ({ t: b * 16, d: 16, m: m - 12, v: 0.4 }))),
  };
  const put = (pat, c, notes) => { if (c) pat.notes[c.id] = notes.map(n => ({ ...n })); };

  const make = (name, i, what) => {
    const p = newPattern(name, PATTERN_COLORS[i % PATTERN_COLORS.length], 64);
    if (what.drums) { put(p, ch.kick, d.kick); put(p, ch.snare, d.snare); put(p, ch.hat, d.hat); put(p, ch.perc, d.perc); }
    if (what.bass) put(p, ch['808 / Bass'], parts.bass);
    if (what.chords) put(p, ch.Chords, parts.chords);
    if (what.melody) put(p, ch.Melody, parts.melody);
    if (what.counter) put(p, ch['Counter melody'], parts.counter);
    if (what.pad) put(p, ch.Pad, parts.pad);
    return p;
  };
  const intro = make('Intro', 0, { chords: 1, pad: 1, melody: 1 });
  const verse = make('Verse', 1, { drums: 1, bass: 1, chords: 1, pad: 1 });
  const hook = make('Hook', 2, { drums: 1, bass: 1, chords: 1, melody: 1, counter: 1, pad: 1 });
  const bridge = make('Bridge', 3, { chords: 1, counter: 1, pad: 1, bass: 1 });
  project.patterns = [intro, verse, hook, bridge];
  project.currentPattern = hook.id;
  project.selectedChannel = (ch.Melody || project.channels[0]).id;

  // arrangement: one track per pattern section so it reads like FL
  const order = [[intro, 1], [hook, 1], [verse, 2], [hook, 2], [bridge, 1], [hook, 2], [intro, 1]];
  project.arrangement.clips = [];
  let at = 0;
  for (const [p, reps] of order) {
    const track = project.patterns.indexOf(p) + 1;
    project.arrangement.clips.push({ id: uid('cl'), type: 'pattern', patternId: p.id, track, start: at, length: p.length * reps });
    at += p.length * reps;
  }
  project.arrangement.tracks.forEach((t, i) => { t.name = project.patterns[i] ? project.patterns[i].name : `Track ${i + 1}`; });
  project.name = `${pick(rng, ['Sigil', 'Ninth Gate', 'Emerald', 'Saturn', 'Good Ending', 'Astral', 'Hermes', 'Lantern', '9990'])} ${pick(rng, ['Anthem', 'Run', 'Ritual', 'Drill', 'Signal', 'Return', 'Transmission', 'Path'])}`;
  return project;
}
