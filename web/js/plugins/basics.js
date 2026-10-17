// Utility effects every DAW is expected to have: EQ, compressor, filter, utility.
// Kept small; the flagship effects are Abyss, Ouroboros, Halo and Seal.
import { knob, select, section, toggle } from '../ui/widgets.js';

const T = 0.02;
function base(ctx, id, name, defaults, state) {
  const input = ctx.createGain(), output = ctx.createGain();
  const p = Object.assign({}, defaults, state || {});
  return { id, name, kind: 'fx', input, output, p, ctx };
}
function finish(o, apply, ui) {
  o.getState = () => ({ ...o.p });
  o.setState = s => { Object.assign(o.p, s); for (const k in o.p) apply(k, o.p[k]); };
  o.set = (k, v) => { o.p[k] = v; apply(k, v); };
  o.renderUI = c => ui(c, o);
  o.dispose = () => { try { o.input.disconnect(); o.output.disconnect(); } catch { } };
  for (const k in o.p) apply(k, o.p[k]);
  return o;
}

export const eq3 = {
  meta: { id: 'eq3', name: 'Tri-Seal EQ', kind: 'fx', description: 'Three band EQ with low/high cut' },
  create(ctx, state) {
    const o = base(ctx, 'eq3', 'Tri-Seal EQ', { lowCut: 20, low: 0, mid: 0, midFreq: 1000, high: 0, highCut: 20000 }, state);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    const ls = ctx.createBiquadFilter(); ls.type = 'lowshelf'; ls.frequency.value = 200;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.Q.value = 0.8;
    const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 6000;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    o.input.connect(hp).connect(ls).connect(pk).connect(hs).connect(lp).connect(o.output);
    const t = ctx.currentTime;
    return finish(o, (k, v) => {
      const m = { lowCut: hp.frequency, low: ls.gain, mid: pk.gain, midFreq: pk.frequency, high: hs.gain, highCut: lp.frequency }[k];
      if (m) m.setTargetAtTime(v, t, T);
    }, (c, o) => {
      const r = section(c, 'EQ');
      knob(r, { label: 'Low cut', min: 20, max: 1000, value: o.p.lowCut, def: 20, onChange: v => o.set('lowCut', v) });
      knob(r, { label: 'Low', min: -15, max: 15, value: o.p.low, def: 0, onChange: v => o.set('low', v), format: v => v.toFixed(1) + 'dB' });
      knob(r, { label: 'Mid', min: -15, max: 15, value: o.p.mid, def: 0, onChange: v => o.set('mid', v), format: v => v.toFixed(1) + 'dB' });
      knob(r, { label: 'Mid Hz', min: 200, max: 8000, value: o.p.midFreq, def: 1000, onChange: v => o.set('midFreq', v) });
      knob(r, { label: 'High', min: -15, max: 15, value: o.p.high, def: 0, onChange: v => o.set('high', v), format: v => v.toFixed(1) + 'dB' });
      knob(r, { label: 'High cut', min: 1000, max: 20000, value: o.p.highCut, def: 20000, onChange: v => o.set('highCut', v) });
    });
  },
};

export const comp = {
  meta: { id: 'comp', name: 'Binding Compressor', kind: 'fx', description: 'Compressor with makeup gain' },
  create(ctx, state) {
    const o = base(ctx, 'comp', 'Binding Compressor', { threshold: -18, ratio: 4, attack: 0.01, release: 0.2, makeup: 3 }, state);
    const c = ctx.createDynamicsCompressor(), mk = ctx.createGain();
    o.input.connect(c).connect(mk).connect(o.output);
    const t = ctx.currentTime;
    return finish(o, (k, v) => {
      if (k === 'makeup') mk.gain.setTargetAtTime(Math.pow(10, v / 20), t, T);
      else if (c[k]) c[k].setTargetAtTime(v, t, T);
    }, (el, o) => {
      const r = section(el, 'Compressor');
      knob(r, { label: 'Thresh', min: -60, max: 0, value: o.p.threshold, onChange: v => o.set('threshold', v) });
      knob(r, { label: 'Ratio', min: 1, max: 20, value: o.p.ratio, onChange: v => o.set('ratio', v), format: v => v.toFixed(1) + ':1' });
      knob(r, { label: 'Attack', min: 0.001, max: 0.3, value: o.p.attack, onChange: v => o.set('attack', v), format: v => (v * 1000).toFixed(0) + 'ms' });
      knob(r, { label: 'Release', min: 0.02, max: 1, value: o.p.release, onChange: v => o.set('release', v), format: v => (v * 1000).toFixed(0) + 'ms' });
      knob(r, { label: 'Makeup', min: 0, max: 18, value: o.p.makeup, onChange: v => o.set('makeup', v), format: v => v.toFixed(1) + 'dB' });
    });
  },
};

export const filter = {
  meta: { id: 'filter', name: 'Veil Filter', kind: 'fx', description: 'Resonant filter with LFO' },
  create(ctx, state) {
    const o = base(ctx, 'filter', 'Veil Filter', { type: 'lowpass', freq: 8000, q: 1, lfoRate: 0.5, lfoDepth: 0 }, state);
    const f = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.connect(depth).connect(f.detune); lfo.start();
    o.input.connect(f).connect(o.output);
    const t = ctx.currentTime;
    const r = finish(o, (k, v) => {
      if (k === 'type') f.type = v;
      if (k === 'freq') f.frequency.setTargetAtTime(v, t, T);
      if (k === 'q') f.Q.setTargetAtTime(v, t, T);
      if (k === 'lfoRate') lfo.frequency.setTargetAtTime(v, t, T);
      if (k === 'lfoDepth') depth.gain.setTargetAtTime(v * 2400, t, T);
    }, (el, o) => {
      const r = section(el, 'Filter');
      select(r, { label: 'Type', options: ['lowpass', 'highpass', 'bandpass', 'notch'], value: o.p.type, onChange: v => o.set('type', v) });
      knob(r, { label: 'Cutoff', min: 40, max: 18000, value: o.p.freq, onChange: v => o.set('freq', v) });
      knob(r, { label: 'Reso', min: 0.1, max: 18, value: o.p.q, onChange: v => o.set('q', v) });
      knob(r, { label: 'LFO Hz', min: 0.05, max: 12, value: o.p.lfoRate, onChange: v => o.set('lfoRate', v) });
      knob(r, { label: 'LFO amt', min: 0, max: 1, value: o.p.lfoDepth, onChange: v => o.set('lfoDepth', v) });
    });
    const d = r.dispose; r.dispose = () => { try { lfo.stop(); } catch { } d(); };
    return r;
  },
};

export const utility = {
  meta: { id: 'utility', name: 'Utility', kind: 'fx', description: 'Gain, pan, width, polarity, mono' },
  create(ctx, state) {
    const o = base(ctx, 'utility', 'Utility', { gain: 0, width: 1, mono: false, invert: false }, state);
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
    // mid/side width: L' = M + wS, R' = M - wS
    const mL = ctx.createGain(), mR = ctx.createGain();
    const g = ctx.createGain();
    o.input.connect(sp);
    sp.connect(mL, 0); sp.connect(mR, 1);
    const L = ctx.createGain(), R = ctx.createGain();
    const sLtoR = ctx.createGain(), sRtoL = ctx.createGain();
    // L' = 0.5(L+R) + 0.5w(L-R) = L*(0.5+0.5w) + R*(0.5-0.5w)
    mL.connect(L); sRtoL.connect(L);
    mR.connect(R); sLtoR.connect(R);
    sp.connect(sRtoL, 1); sp.connect(sLtoR, 0);
    L.connect(mg, 0, 0); R.connect(mg, 0, 1);
    mg.connect(g).connect(o.output);
    const t = ctx.currentTime;
    const applyWidth = () => {
      const w = o.p.mono ? 0 : o.p.width, a = 0.5 + 0.5 * w, b = 0.5 - 0.5 * w, s = o.p.invert ? -1 : 1;
      mL.gain.setTargetAtTime(a * s, t, T); mR.gain.setTargetAtTime(a * s, t, T);
      sRtoL.gain.setTargetAtTime(b * s, t, T); sLtoR.gain.setTargetAtTime(b * s, t, T);
    };
    return finish(o, (k, v) => {
      if (k === 'gain') g.gain.setTargetAtTime(Math.pow(10, v / 20), t, T);
      else applyWidth();
    }, (el, o) => {
      const r = section(el, 'Utility');
      knob(r, { label: 'Gain', min: -24, max: 24, value: o.p.gain, def: 0, onChange: v => o.set('gain', v), format: v => v.toFixed(1) + 'dB' });
      knob(r, { label: 'Width', min: 0, max: 2, value: o.p.width, def: 1, onChange: v => o.set('width', v), format: v => Math.round(v * 100) + '%' });
      toggle(r, { label: 'Mono', value: o.p.mono, onChange: v => o.set('mono', v) });
      toggle(r, { label: 'Ø Invert', value: o.p.invert, onChange: v => o.set('invert', v) });
    });
  },
};
