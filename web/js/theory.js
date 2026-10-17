// Music theory: scales, key highlighting, and the chord sets on the number row.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  'Minor': [0, 2, 3, 5, 7, 8, 10],
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Hijaz (Phrygian Dominant)': [0, 1, 4, 5, 7, 8, 10],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export function inKey(midi, key) {
  const pc = (((midi - key.root) % 12) + 12) % 12;
  return SCALES[key.scale].includes(pc);
}
export const isRoot = (midi, key) => (((midi - key.root) % 12) + 12) % 12 === 0;

// Nearest in-key note (ties go down). Used by "snap to key".
export function snapToKey(midi, key) {
  for (let d = 0; d < 7; d++) {
    if (inKey(midi - d, key)) return midi - d;
    if (inKey(midi + d, key)) return midi + d;
  }
  return midi;
}

// Diatonic triad/7th on scale degree (0-based), stacked in thirds inside the scale.
export function diatonicChord(key, degree, { size = 3, octave = 4 } = {}) {
  const sc = SCALES[key.scale].length === 7 ? SCALES[key.scale] : SCALES['Minor'];
  const out = [];
  for (let i = 0; i < size; i++) {
    const idx = degree + i * 2;
    const oct = Math.floor(idx / 7);
    out.push(12 * (octave + 1) + key.root + sc[idx % 7] + 12 * oct);
  }
  return out;
}

// Chord from semitone offsets relative to the key root.
const rel = (key, root, ivs, octave = 4) => ivs.map(i => 12 * (octave + 1) + key.root + root + i);

// The number row: ten chords that all sit well together in the current key.
// 1..7 are the diatonic sevenths/add9s, 8..0 are pleasant colour chords.
export function numberRowChords(key) {
  const minorish = SCALES[key.scale].includes(3) && !SCALES[key.scale].includes(4);
  if (minorish) {
    return [
      { label: 'i9', notes: rel(key, 0, [0, 3, 7, 14]) },
      { label: 'iv7', notes: rel(key, 5, [0, 3, 7, 10]) },
      { label: 'VImaj7', notes: rel(key, 8, [0, 4, 7, 11], 3) },
      { label: 'III', notes: rel(key, 3, [0, 4, 7]) },
      { label: 'VII', notes: rel(key, 10, [0, 4, 7], 3) },
      { label: 'v7', notes: rel(key, 7, [0, 3, 7, 10], 3) },
      { label: 'i/5', notes: rel(key, 0, [-5, 0, 3, 7]) },
      { label: 'VIadd9', notes: rel(key, 8, [0, 4, 7, 14], 3) },
      { label: 'IVsus (dorian)', notes: rel(key, 5, [0, 5, 7, 9]) },
      { label: 'Vsus4', notes: rel(key, 7, [0, 5, 7], 3) },
    ];
  }
  return [
    { label: 'Imaj9', notes: rel(key, 0, [0, 4, 7, 11, 14]) },
    { label: 'IVmaj7', notes: rel(key, 5, [0, 4, 7, 11]) },
    { label: 'vi7', notes: rel(key, 9, [0, 3, 7, 10], 3) },
    { label: 'V', notes: rel(key, 7, [0, 4, 7], 3) },
    { label: 'ii9', notes: rel(key, 2, [0, 3, 7, 10, 14]) },
    { label: 'iii7', notes: rel(key, 4, [0, 3, 7, 10]) },
    { label: 'I/3', notes: rel(key, 0, [4, 7, 12]) },
    { label: 'IVadd9', notes: rel(key, 5, [0, 4, 7, 14]) },
    { label: 'V/vi', notes: rel(key, 4, [0, 4, 7, 10]) },
    { label: 'Vsus4', notes: rel(key, 7, [0, 5, 7], 3) },
  ];
}

// Murmur's "you didn't see that coming but it slaps" chords. Borrowed chords,
// Neapolitans, tritone subs: each resolves somewhere nice from the key.
export function spiceChords(key) {
  return [
    { label: 'bII maj7 (Neapolitan)', notes: rel(key, 1, [0, 4, 7, 11]) },
    { label: 'bVI maj7#11', notes: rel(key, 8, [0, 4, 7, 11, 18], 3) },
    { label: 'iv minor (borrowed)', notes: rel(key, 5, [0, 3, 7, 14]) },
    { label: 'V7/V', notes: rel(key, 2, [0, 4, 7, 10]) },
    { label: 'bVII9', notes: rel(key, 10, [0, 4, 7, 10, 14], 3) },
    { label: 'II7b5 (tritone sub)', notes: rel(key, 1, [0, 4, 6, 10]) },
    { label: 'IV/I (gospel lift)', notes: rel(key, 0, [0, 5, 9, 12]) },
    { label: 'bIII aug', notes: rel(key, 3, [0, 4, 8]) },
    { label: 'm(maj7) cliffhanger', notes: rel(key, 0, [0, 3, 7, 11]) },
    { label: '9990 cluster (add9 add11)', notes: rel(key, 0, [0, 2, 5, 7, 14]) },
  ];
}
