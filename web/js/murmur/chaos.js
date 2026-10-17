// Murmur's moves. Each one is a single undoable change on the project.
import { store, newChannel, uid } from '../state.js';
import { app } from '../app.js';
import { SOUNDS } from '../audio/soundbank.js';
import { summon } from '../plugins/sigil.js';
import { mulberry32, pick } from '../audio/rng.js';
import { snapToKey, spiceChords, NOTE_NAMES, SCALES } from '../theory.js';
import { drums, bassline, progression, melody, chordNotes, buildSong, STYLES, readVibe, variation, remix, rerollPattern, changeScale } from '../generate.js';
import { splitPattern } from '../ui/pattern.js';

const rng = () => mulberry32((Date.now() ^ 9990) >>> 0);
export const pickSound = (cat, r = Math.random) => {
  const pool = SOUNDS.filter(s => s.category === cat);
  return (pool.length ? pool[Math.floor(r() * pool.length)] : SOUNDS[0]).id;
};
const soundOf = c => (c.source.type === 'sound' ? SOUNDS.find(s => s.id === c.source.soundId) : null);
const isDrum = c => soundOf(c)?.kind === 'drum';
const cat = c => soundOf(c)?.category || (c.source.pluginId === 'sigil' ? 'Sigil' : '');
const curPat = pr => pr.patterns.find(p => p.id === pr.currentPattern);

function melodicChannels(pr) { return pr.channels.filter(c => !isDrum(c)); }
function addChannel(pr, name, source) {
  const used = new Set(pr.channels.map(c => c.mixer));
  let mix = 0; for (let i = 1; i <= 16; i++) if (!used.has(i)) { mix = i; break; }
  const c = newChannel(name, source, mix); pr.channels.push(c); return c;
}
function chordsOf(notes) {
  const by = new Map();
  for (const n of notes) { const k = n.t; if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
  return [...by.entries()].filter(([, ns]) => ns.length >= 3);
}
const styleGuess = pr => (pr.bpm >= 138 ? 'drill' : pr.bpm >= 110 ? 'anthem' : pr.bpm >= 70 ? 'lofi' : 'ambient');

// --- the moves ------------------------------------------------------------------

export const MOVES = {
  level_up_melody() {
    const r = rng();
    let out = null;
    app.change('Murmur: leveled up the melody', pr => {
      const pat = curPat(pr);
      const cands = melodicChannels(pr).filter(c => (pat.notes[c.id] || []).length && !chordsOf(pat.notes[c.id]).length);
      const ch = cands.find(c => c.id === pr.selectedChannel) || cands[0];
      if (!ch) { const c = melodicChannels(pr)[0] || addChannel(pr, 'Sigil', { type: 'plugin', pluginId: 'sigil', state: summon(9990) }); pat.notes[c.id] = melody(pr.key, progression(pr.key, styleGuess(pr), r, pat.length / 16), r); out = `There was no melody so I wrote one on ${c.name}.`; return; }
      const src = pat.notes[ch.id].slice().sort((a, b) => a.t - b.t);
      const res = [];
      src.forEach((n, i) => {
        const roll = r();
        if (roll < 0.18 && n.d >= 2) { // grace note from below
          res.push({ ...n, t: n.t, d: 0.5, m: snapToKey(n.m - 1, pr.key), v: 0.6 });
          res.push({ ...n, t: n.t + 0.5, d: n.d - 0.5 });
        } else if (roll < 0.32 && n.d >= 4) { // stutter long notes
          const k = n.d >= 8 ? 4 : 2;
          for (let j = 0; j < k; j++) res.push({ ...n, t: n.t + j * n.d / k, d: n.d / k * 0.9, v: (n.v ?? 0.8) * (j ? 0.8 : 1) });
        } else if (roll < 0.42 && i === src.length - 1) { // octave lift on the last note
          res.push({ ...n, m: n.m + 12 });
        } else res.push({ ...n });
        // triplet run into the next bar
        const nx = src[i + 1];
        if (nx && Math.floor(nx.t / 16) > Math.floor(n.t / 16) && r() < 0.35 && nx.t - (n.t + n.d) >= 2) {
          const end = nx.t;
          for (let j = 0; j < 3; j++) res.push({ t: end - 2 + j * (2 / 3), d: 0.6, m: snapToKey(nx.m + (2 - j) * 2, pr.key), v: 0.65 });
        }
      });
      pat.notes[ch.id] = res;
      out = `Gave ${ch.name} grace notes, a stutter and a run into the next bar.`;
    });
    return out;
  },

  spice_chord() {
    let out = null;
    app.change('Murmur: spice chord', pr => {
      const pat = curPat(pr);
      const spices = spiceChords(pr.key);
      const sp = pick(rng(), spices);
      for (const c of melodicChannels(pr)) {
        const chords = chordsOf(pat.notes[c.id] || []);
        if (!chords.length) continue;
        // swap the chord right before the loop point: maximum "wait what" energy
        const [t, ns] = chords[chords.length - 1];
        const d = Math.max(...ns.map(n => n.d)), v = ns[0].v ?? 0.6;
        const centre = ns.reduce((s, n) => s + n.m, 0) / ns.length;
        const shift = Math.round((centre - sp.notes.reduce((s, m) => s + m, 0) / sp.notes.length) / 12) * 12;
        pat.notes[c.id] = pat.notes[c.id].filter(n => n.t !== t).concat(sp.notes.map(m => ({ t, d, m: m + shift, v })));
        out = `Swapped the last chord on ${c.name} for a ${sp.label}. Sounds wrong on paper, sounds expensive in your ears.`;
        return;
      }
      const c = pr.channels.find(x => x.id === pr.selectedChannel && !isDrum(x)) || melodicChannels(pr)[0];
      if (!c) return;
      (pat.notes[c.id] || (pat.notes[c.id] = [])).push(...sp.notes.map(m => ({ t: Math.max(0, pat.length - 16), d: 16, m, v: 0.6 })));
      out = `No chords yet, so I put a ${sp.label} at the end of ${c.name}. Build toward it.`;
    });
    return out;
  },

  autocomplete() {
    const r = rng();
    let out = null;
    app.change('Murmur: finished the track', pr => {
      const style = styleGuess(pr);
      const pat = curPat(pr);
      const bars = pat.length / 16;
      const chords = progression(pr.key, style, r, bars);
      const d = drums(style, r, bars);
      const filled = [];
      for (const c of pr.channels) {
        if ((pat.notes[c.id] || []).length || (pat.steps[c.id] || []).some(Boolean)) continue;
        const k = cat(c);
        let notes = null;
        if (k === 'Kicks') notes = d.kick; else if (k === 'Snares' || k === 'Claps') notes = d.snare;
        else if (k === 'Hats') notes = d.hat; else if (k === 'Percussion' || k === 'FX') notes = d.perc;
        else if (k === '808s' || k === 'Bass') notes = bassline(chords, d.kick, style, r, k === '808s');
        else if (k === 'Keys' || k === 'Pads' || k === 'Vox/Choir') notes = chordNotes(chords, style, r);
        else notes = melody(pr.key, chords, r);
        pat.notes[c.id] = notes; filled.push(c.name);
      }
      if (!pr.arrangement.clips.length) {
        let at = 0;
        for (const [i, reps] of [[0, 1], [0, 2], [0, 2], [0, 1]]) {
          const p = pr.patterns[Math.min(i, pr.patterns.length - 1)];
          pr.arrangement.clips.push({ id: uid('cl'), type: 'pattern', patternId: p.id, track: 1, start: at, length: p.length * reps });
          at += p.length * reps;
        }
        filled.push('a rough arrangement in the playlist');
      }
      out = filled.length ? `Filled in ${filled.join(', ')}. Wild card ${style} energy. Keep what hits.` : `Everything already has notes. You're further along than you think.`;
    });
    return out;
  },

  swap_instrument() {
    let out = null;
    app.change('Murmur: swapped an instrument', pr => {
      const pool = melodicChannels(pr);
      if (!pool.length) return;
      const r = rng();
      const c = pick(r, pool);
      if (r() < 0.35 || c.source.type === 'plugin') {
        const seed = Math.floor(r() * 99990);
        out = `Replaced ${c.name}'s sound with a fresh Sigil patch (seed ${seed}).`;
        c.source = { type: 'plugin', pluginId: 'sigil', state: summon(seed) };
        c.name = `Sigil #${seed}`;
      } else {
        const k = cat(c);
        const near = { Leads: ['Plucks', 'Bells'], Plucks: ['Bells', 'Keys', 'Leads'], Bells: ['Plucks', 'Keys'], Keys: ['Pads', 'Plucks'], Pads: ['Vox/Choir', 'Textures', 'Keys'], 'Vox/Choir': ['Pads'], Bass: ['808s'], '808s': ['Bass', '808s'], Textures: ['Pads'] }[k] || ['Leads'];
        const id = pickSound(pick(r, near), r);
        const s = SOUNDS.find(x => x.id === id);
        out = `${c.name} is now ${s.name}. Different color, same soul.`;
        c.source = { type: 'sound', soundId: id }; c.name = s.name;
      }
    });
    return out;
  },

  add_sfx() {
    let out = null;
    app.change('Murmur: added a sound effect', pr => {
      const pat = curPat(pr);
      let fx = pr.channels.find(c => cat(c) === 'FX');
      if (!fx) { const id = pickSound('FX'); fx = addChannel(pr, SOUNDS.find(s => s.id === id).name, { type: 'sound', soundId: id }); }
      const arr = pat.notes[fx.id] || (pat.notes[fx.id] = []);
      const t = pick(rng(), [0, pat.length - 4, Math.floor(pat.length / 2)]);
      arr.push({ t, d: 4, m: 60, v: 0.8 });
      out = `Dropped ${fx.name} at step ${t + 1}. Transitions are where the magic hides.`;
    });
    return out;
  },

  drillify() {
    const r = rng();
    let out = null;
    app.change('Murmur: drill conversion', pr => {
      pr.bpm = 142; pr.swing = 0;
      const pat = curPat(pr);
      const bars = pat.length / 16;
      const d = drums('drill', r, bars);
      const need = [['Kicks', 'Kick', d.kick], ['Snares', 'Snare', d.snare], ['Hats', 'Hat', d.hat], ['Percussion', 'Perc', d.perc]];
      for (const [k, name, notes] of need) {
        let c = pr.channels.find(x => cat(x) === k);
        if (!c) c = addChannel(pr, name, { type: 'sound', soundId: pickSound(k, r) });
        pat.steps[c.id] = [];
        pat.notes[c.id] = notes;
      }
      let b = pr.channels.find(x => cat(x) === '808s');
      if (!b) b = addChannel(pr, '808', { type: 'sound', soundId: pickSound('808s', r) });
      pat.notes[b.id] = bassline(progression(pr.key, 'drill', r, bars), d.kick, 'drill', r, cat(b) === '808s');
      out = 'FINALLY. 142, sliding 808, triplet hats, snare on the three. This is the good ending.';
    });
    return out;
  },

  new_drums(style) {
    const r = rng();
    let out = null;
    app.change('Murmur: new drums', pr => {
      style = STYLES[style] ? style : styleGuess(pr);
      const pat = curPat(pr);
      const d = drums(style, r, pat.length / 16);
      for (const [k, name, notes] of [['Kicks', 'Kick', d.kick], [style === 'anthem' ? 'Claps' : 'Snares', 'Snare', d.snare], ['Hats', 'Hat', d.hat]]) {
        let c = pr.channels.find(x => cat(x) === k) || addChannel(pr, name, { type: 'sound', soundId: pickSound(k, r) });
        pat.steps[c.id] = []; pat.notes[c.id] = notes;
      }
      out = `New ${style} drums in. Hit play.`;
    });
    return out;
  },

  set_bpm(v) {
    const bpm = Math.max(40, Math.min(240, Math.round(+v)));
    if (!bpm) return null;
    app.change(`BPM ${bpm}`, pr => { pr.bpm = bpm; });
    return `Tempo is ${bpm}.${bpm >= 138 && bpm <= 146 ? ' Drill zone. I see you.' : ''}`;
  },

  set_key(v) {
    const m = String(v).match(/([A-Ga-g])\s*([#b♯♭]?)\s*(.*)/);
    if (!m) return null;
    let root = NOTE_NAMES.indexOf(m[1].toUpperCase());
    if (m[2] === '#' || m[2] === '♯') root++; if (m[2] === 'b' || m[2] === '♭') root--;
    root = (root + 12) % 12;
    const want = (m[3] || 'minor').toLowerCase();
    const scale = Object.keys(SCALES).find(s => s.toLowerCase() === want) || Object.keys(SCALES).find(s => s.toLowerCase().startsWith(want.split(' ')[0])) || 'Minor';
    app.change(`Key ${NOTE_NAMES[root]} ${scale}`, pr => { pr.key = { root, scale }; });
    return `Key is ${NOTE_NAMES[root]} ${scale}. The piano roll lights up the right rows now.`;
  },

  summon_synth() {
    const seed = Math.floor(Math.random() * 99990);
    let out = null;
    app.change('Murmur: summoned a synth', pr => {
      let c = pr.channels.find(x => x.id === pr.selectedChannel && x.source.type === 'plugin');
      if (!c) c = addChannel(pr, `Sigil #${seed}`, { type: 'plugin', pluginId: 'sigil', state: null });
      c.source = { type: 'plugin', pluginId: 'sigil', state: summon(seed) };
      c.name = `Sigil #${seed}`;
      pr.selectedChannel = c.id;
      out = `Summoned Sigil #${seed}. Play it with A through ' on your keyboard.`;
    });
    return out;
  },

  mystery_box(v) {
    const text = String(v || '');
    const seed = Math.floor(Math.random() * 99990);
    let info;
    app.change('Murmur: mystery box', pr => { info = buildSong(pr, { style: STYLES[text] ? text : null, vibe: text, seed, split: /split|per instrument|track per/i.test(text) }); });
    return `Mystery box opened: ${store.project.name}. ${STYLES[info.style].label}${info.mood ? ', ' + info.mood : ''}, ${store.project.bpm} BPM, seed ${seed}. Press space. Everything in it is editable.`;
  },

  variation() {
    let n = 0;
    app.change('Murmur: new variation', pr => { n = variation(pr); });
    return n ? `New melodies across ${n} parts. Same key, same beat, different spirit.` : 'No melody parts to vary yet.';
  },

  remix(style) {
    style = String(style || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!STYLES[style]) style = pick(rng(), Object.keys(STYLES).filter(s => s !== store.project.gen?.style));
    let ok = false;
    app.change(`Murmur: remix as ${style}`, pr => { ok = remix(pr, style); });
    return ok ? `Remixed into ${STYLES[style].label} at ${store.project.bpm} BPM. Melody and chords stayed, the drums and bass got possessed.` : null;
  },

  reroll_section(name) {
    const want = String(name || '').toLowerCase();
    const pat = store.project.patterns.find(p => want && p.name.toLowerCase().includes(want)) || store.pattern();
    let ok = false;
    app.change(`Murmur: re-rolled ${pat.name}`, pr => { ok = rerollPattern(pr, pat.id); });
    return ok ? `Re-rolled the melodic parts of ${pat.name}.` : null;
  },

  darker() {
    const to = store.project.key.scale === 'Phrygian' ? 'Harmonic Minor' : store.project.key.scale === 'Minor' ? 'Phrygian' : 'Minor';
    app.change(`Murmur: darker (${to})`, pr => changeScale(pr, to));
    return `Moved everything into ${to}. Lights off.`;
  },

  brighter() {
    const to = store.project.key.scale === 'Major' ? 'Lydian' : ['Minor', 'Phrygian', 'Harmonic Minor'].includes(store.project.key.scale) ? 'Dorian' : 'Major';
    app.change(`Murmur: brighter (${to})`, pr => changeScale(pr, to));
    return `Moved everything into ${to}. Sun's out.`;
  },

  split() {
    const pat = store.pattern();
    return splitPattern(pat.id) ? `Split ${pat.name} into one pattern per instrument. Check the playlist: you can switch each instrument on and off per section now.` : 'Only one instrument in this pattern, nothing to split.';
  },

  write_notes(v) {
    let spec;
    try { spec = typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
    if (!spec || !Array.isArray(spec.notes)) return null;
    let name = null;
    app.change('Murmur: wrote notes', pr => {
      const pat = curPat(pr);
      let c = pr.channels.find(x => x.name.toLowerCase() === String(spec.channel || '').toLowerCase()) || pr.channels.find(x => x.id === pr.selectedChannel);
      if (!c) return;
      const clean = spec.notes.filter(n => isFinite(n.t) && isFinite(n.d) && isFinite(n.m)).map(n => ({ t: Math.max(0, +n.t), d: Math.max(0.25, +n.d), m: Math.max(0, Math.min(127, Math.round(+n.m))), v: Math.max(0.05, Math.min(1, +(n.v ?? 0.8))) }));
      if (spec.replace !== false) pat.notes[c.id] = clean; else (pat.notes[c.id] || (pat.notes[c.id] = [])).push(...clean);
      pat.length = Math.max(pat.length, Math.ceil(Math.max(0, ...clean.map(n => n.t + n.d)) / 16) * 16);
      name = c.name;
    });
    return name ? `Wrote ${spec.notes.length} notes on ${name}.` : null;
  },
};

// The ones Murmur may do unprompted.
export const CHAOS_POOL = ['level_up_melody', 'spice_chord', 'swap_instrument', 'add_sfx', 'autocomplete'];
