// Audio engine: builds the graph from the project, schedules patterns and the
// song, plays live notes. The same class renders offline for WAV export.
import { createPlugin } from '../plugins/index.js';
import { SOUNDS, createSoundInstrument } from './soundbank.js';
import { STEPS_PER_BAR } from '../state.js';
import { getSampleBuffer } from '../io/db.js';

const firstSoundIn = cat => (SOUNDS.find(s => s.category === cat) || SOUNDS[0]).id;

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    this.channels = new Map();   // channel id -> { inst, key, gain, pan }
    this.mixer = new Map();      // mixer track id -> { input, fxChain, pan, gain, fx: [] }
    this.masterIn = ctx.createGain();
    this.masterOut = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.masterFx = [];
    // last-resort safety limiter so nothing ever clips the speakers
    this.safety = ctx.createDynamicsCompressor();
    this.safety.threshold.value = -1; this.safety.knee.value = 0; this.safety.ratio.value = 20;
    this.safety.attack.value = 0.001; this.safety.release.value = 0.08;
    this.masterOut.connect(this.safety).connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.masterKey = '';
    this.sampleBuffers = new Map();
    this.activeSources = new Set();
    this.onStep = null;
  }

  // --- graph --------------------------------------------------------------

  sync(project) {
    const ctx = this.ctx;
    // mixer tracks (0 = master direct)
    for (const t of project.mixer.tracks) {
      let m = this.mixer.get(t.id);
      if (!m) {
        m = { input: ctx.createGain(), pan: ctx.createStereoPanner(), gain: ctx.createGain(), fx: [], fxKey: '' };
        m.pan.connect(m.gain).connect(this.masterIn);
        this.mixer.set(t.id, m);
      }
      this.rebuildChain(m, t.fx, m.input, m.pan, project.bpm);
      m.gain.gain.setTargetAtTime(t.mute ? 0 : t.gain, ctx.currentTime, 0.01);
      m.pan.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.01);
    }
    // master
    const master = { fx: this.masterFx, fxKey: this.masterKey };
    this.rebuildChain(master, project.mixer.master.fx, this.masterIn, this.masterOut, project.bpm);
    this.masterFx = master.fx; this.masterKey = master.fxKey;
    this.masterOut.gain.setTargetAtTime(project.mixer.master.gain, ctx.currentTime, 0.01);

    // channels
    const anySolo = project.channels.some(c => c.solo);
    const seen = new Set();
    for (const c of project.channels) {
      seen.add(c.id);
      if (c.source.type === 'sound' && !c.source.soundId) c.source.soundId = firstSoundIn(c.source.prefer || 'Kicks');
      const key = JSON.stringify([c.source.type, c.source.soundId, c.source.pluginId]);
      let ch = this.channels.get(c.id);
      if (ch && ch.key !== key) { this.disposeChannel(ch); ch = null; }
      if (!ch) {
        const inst = c.source.type === 'sound'
          ? createSoundInstrument(ctx, c.source.soundId, c.source.state)
          : createPlugin(ctx, c.source.pluginId, c.source.state, { getBuffer: id => this.sampleBuffers.get(id) });
        const gain = ctx.createGain(), pan = ctx.createStereoPanner();
        inst.output.connect(pan).connect(gain);
        ch = { inst, key, gain, pan, stateJson: JSON.stringify(c.source.state || null) };
        this.channels.set(c.id, ch);
      } else {
        // state came back from undo/redo or Murmur: push it into the live plugin
        const sj = JSON.stringify(c.source.state || null);
        if (sj !== ch.stateJson && c.source.state && ch.inst.setState) ch.inst.setState(c.source.state);
        ch.stateJson = sj;
      }
      try { ch.gain.disconnect(); } catch { }
      ch.gain.connect(this.mixerInput(c.mixer));
      const audible = !c.mute && (!anySolo || c.solo);
      ch.gain.gain.setTargetAtTime(audible ? c.gain : 0, ctx.currentTime, 0.01);
      ch.pan.pan.setTargetAtTime(c.pan, ctx.currentTime, 0.01);
    }
    for (const [id, ch] of this.channels) if (!seen.has(id)) { this.disposeChannel(ch); this.channels.delete(id); }
    this.project = project;
  }

  mixerInput(id) {
    const m = this.mixer.get(id);
    return m ? m.input : this.masterIn;
  }

  rebuildChain(holder, fxList, from, to, bpm) {
    const key = JSON.stringify(fxList.map(f => [f.pluginId, !!f.bypass]));
    if (holder.fxKey === key) {
      // same chain, just push states that changed underneath (undo)
      fxList.forEach((f, i) => {
        const live = holder.fx[i];
        if (live && f.state && JSON.stringify(f.state) !== live.stateJson) { live.plugin.setState(f.state); live.stateJson = JSON.stringify(f.state); }
      });
      return;
    }
    try { from.disconnect(); } catch { }
    for (const f of holder.fx) f.plugin.dispose();
    holder.fx = [];
    let node = from;
    for (const f of fxList) {
      const plugin = createPlugin(this.ctx, f.pluginId, f.state);
      if (plugin.setTempo) plugin.setTempo(bpm);
      holder.fx.push({ plugin, stateJson: JSON.stringify(f.state || null) });
      if (f.bypass) continue;
      node.connect(plugin.input);
      node = plugin.output;
    }
    node.connect(to);
    holder.fxKey = key;
  }

  disposeChannel(ch) {
    try { ch.inst.allNotesOff && ch.inst.allNotesOff(); ch.inst.dispose(); ch.gain.disconnect(); } catch { }
  }

  // Copies live plugin params back into the project (before saving/undo snapshots).
  collect(project) {
    for (const c of project.channels) {
      const ch = this.channels.get(c.id);
      if (ch && ch.inst.getState) { c.source.state = ch.inst.getState(); ch.stateJson = JSON.stringify(c.source.state); }
    }
    for (const t of project.mixer.tracks) {
      const m = this.mixer.get(t.id);
      if (m) t.fx.forEach((f, i) => { const l = m.fx[i]; if (l) { f.state = l.plugin.getState(); l.stateJson = JSON.stringify(f.state); } });
    }
    project.mixer.master.fx.forEach((f, i) => { const l = this.masterFx[i]; if (l) { f.state = l.plugin.getState(); l.stateJson = JSON.stringify(f.state); } });
  }

  livePlugin(where) {
    if (where.channel) return this.channels.get(where.channel)?.inst;
    if (where.master != null) return this.masterFx[where.master]?.plugin;
    return this.mixer.get(where.track)?.fx[where.slot]?.plugin;
  }

  setTempo(bpm) {
    for (const m of this.mixer.values()) for (const f of m.fx) f.plugin.setTempo && f.plugin.setTempo(bpm);
    for (const f of this.masterFx) f.plugin.setTempo && f.plugin.setTempo(bpm);
  }

  // --- live notes -----------------------------------------------------------

  noteOn(channelId, midi, vel = 0.85) {
    const ch = this.channels.get(channelId);
    if (ch) ch.inst.noteOn(midi, vel, this.ctx.currentTime + 0.005);
  }
  noteOff(channelId, midi) {
    const ch = this.channels.get(channelId);
    if (ch) ch.inst.noteOff(midi, this.ctx.currentTime + 0.005);
  }
  previewNote(channelId, midi, dur = 0.25) {
    const ch = this.channels.get(channelId);
    if (ch) ch.inst.playNote(midi, 0.8, this.ctx.currentTime + 0.005, dur);
  }

  // --- scheduling -------------------------------------------------------------

  stepDur(project = this.project) { return 60 / project.bpm / 4; }

  // Schedule one pattern's events for steps [s0, s1) of that pattern, where
  // step s plays at time t0 + (s - s0) * stepDur (plus swing).
  schedulePatternSteps(pattern, s0, s1, t0, offsetSteps = 0) {
    const project = this.project, sd = this.stepDur(project);
    const swingAt = s => (s % 2 === 1 ? project.swing * sd * 0.5 : 0);
    for (const c of project.channels) {
      const ch = this.channels.get(c.id);
      if (!ch) continue;
      const steps = pattern.steps[c.id];
      if (steps) {
        for (let s = Math.ceil(s0); s < s1; s++) {
          const st = steps[s % pattern.length];
          if (st) {
            const vel = typeof st === 'number' ? st : 0.85;
            ch.inst.playNote(c.source.pitch || 60, vel, t0 + (s - s0) * sd + swingAt(s + offsetSteps), sd * 0.9);
          }
        }
      }
      const notes = pattern.notes[c.id];
      if (notes) {
        for (const n of notes) {
          if (n.t >= s0 && n.t < s1) {
            const when = t0 + (n.t - s0) * sd + (Number.isInteger(n.t) ? swingAt(n.t + offsetSteps) : 0);
            ch.inst.playNote(n.m, n.v ?? 0.85, when, Math.max(0.02, n.d * sd));
          }
        }
      }
    }
  }

  // Schedule song-mode events in song steps [s0, s1) starting at time t0.
  scheduleSongSteps(s0, s1, t0) {
    const project = this.project, sd = this.stepDur(project);
    for (const clip of project.arrangement.clips) {
      const track = project.arrangement.tracks.find(t => t.id === clip.track);
      if (track && track.mute) continue;
      const cs = clip.start, ce = clip.start + clip.length;
      if (ce <= s0 || cs >= s1) continue;
      if (clip.type === 'pattern') {
        const pat = project.patterns.find(p => p.id === clip.patternId);
        if (!pat) continue;
        // walk the overlapping window in pattern-local time (patterns loop inside long clips)
        const a = Math.max(s0, cs), b = Math.min(s1, ce);
        let local = a - cs;
        let t = t0 + (a - s0) * sd;
        while (local < b - cs) {
          const pl = local % pat.length;
          const chunk = Math.min(pat.length - pl, b - cs - local);
          this.schedulePatternSteps(pat, pl, pl + chunk, t, cs + local - pl);
          local += chunk; t += chunk * sd;
        }
      } else if (clip.type === 'audio' && cs >= s0 && cs < s1) {
        this.playSampleClip(clip, t0 + (cs - s0) * sd, 0, track);
      } else if (clip.type === 'audio' && cs < s0 && s0 === this._songStartStep) {
        // starting playback in the middle of an audio clip
        this.playSampleClip(clip, t0, (s0 - cs) * sd, track);
      }
    }
  }

  playSampleClip(clip, when, intoClip, track) {
    const buf = this.sampleBuffers.get(clip.sampleId);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = clip.gain ?? 1;
    src.connect(g).connect(this.mixerInput(track ? track.mixer : 0));
    const sd = this.stepDur();
    const dur = clip.length * sd - intoClip;
    if (dur <= 0) return;
    src.start(when, (clip.offset || 0) + intoClip, dur);
    this.activeSources.add(src);
    src.onended = () => { this.activeSources.delete(src); g.disconnect(); };
  }

  async loadSamples(project) {
    for (const id of Object.keys(project.samples)) {
      if (this.sampleBuffers.has(id)) continue;
      const buf = await getSampleBuffer(this.ctx, id);
      if (buf) this.sampleBuffers.set(id, buf);
    }
  }

  songLength(project = this.project) {
    let end = 0;
    for (const c of project.arrangement.clips) end = Math.max(end, c.start + c.length);
    return Math.ceil(end / STEPS_PER_BAR) * STEPS_PER_BAR;
  }

  // --- realtime transport ----------------------------------------------------

  start(mode, fromStep = 0) {
    if (this.timer) this.stop();
    this.mode = mode;
    this.nextStep = fromStep;
    this._songStartStep = fromStep;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  tick() {
    const ahead = this.ctx.currentTime + 0.12;
    const p = this.project, sd = this.stepDur(p);
    while (this.nextTime < ahead) {
      const s = this.nextStep;
      if (this.mode === 'pattern') {
        const pat = p.patterns.find(x => x.id === p.currentPattern);
        if (pat) this.schedulePatternSteps(pat, s % pat.length, s % pat.length + 1, this.nextTime, 0);
      } else {
        const len = this.songLength() || STEPS_PER_BAR * 4;
        const loop = p.arrangement.loop;
        this.scheduleSongSteps(s, s + 1, this.nextTime);
        this._songStartStep = -1;
        if (loop && s + 1 >= loop.end) { this.nextStep = loop.start - 1; this._songStartStep = loop.start; }
        else if (s + 1 >= len) { this.nextStep = -1; this._songStartStep = 0; }
      }
      const stepNow = s, at = this.nextTime;
      if (this.onStep) {
        const delay = Math.max(0, (at - this.ctx.currentTime) * 1000);
        setTimeout(() => this.onStep && this.onStep(stepNow), delay);
      }
      this.nextStep++;
      this.nextTime += sd;
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const ch of this.channels.values()) ch.inst.allNotesOff && ch.inst.allNotesOff();
    for (const s of this.activeSources) { try { s.stop(); } catch { } }
    this.activeSources.clear();
  }
}

// --- offline render -----------------------------------------------------------

export async function renderSong(project, { sampleRate = 44100, tailSeconds = 3, patternOnly = false } = {}) {
  const sd = 60 / project.bpm / 4;
  const pat = project.patterns.find(p => p.id === project.currentPattern);
  let steps = 0;
  for (const c of project.arrangement.clips) steps = Math.max(steps, c.start + c.length);
  if (patternOnly || steps === 0) { patternOnly = true; steps = pat.length; }
  const length = Math.ceil((steps * sd + tailSeconds) * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const e = new Engine(ctx);
  await e.loadSamples(project);
  e.sync(JSON.parse(JSON.stringify(project)));
  e.setTempo(project.bpm);
  e._songStartStep = 0;
  // Schedule one bar at a time just ahead of the render position. Scheduling the
  // whole song up front keeps thousands of idle voice nodes alive from sample 0.
  const CHUNK = STEPS_PER_BAR, lead = 0.05;
  const schedule = s0 => {
    const s1 = Math.min(steps, s0 + CHUNK);
    if (patternOnly) e.schedulePatternSteps(pat, s0, s1, lead + s0 * sd, 0);
    else e.scheduleSongSteps(s0, s1, lead + s0 * sd);
    e._songStartStep = -1;
  };
  schedule(0);
  for (let s = CHUNK; s < steps; s += CHUNK) {
    const at = Math.max(0, lead + s * sd - 0.5);
    const q = 128 / sampleRate; // suspend times are rounded to render quanta
    ctx.suspend(Math.floor(at / q) * q).then(() => { schedule(s); ctx.resume(); });
  }
  return ctx.startRendering();
}
