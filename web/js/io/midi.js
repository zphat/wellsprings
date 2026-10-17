// Standard MIDI file export/import (type 1, 96 ticks per quarter) and Web MIDI input.
const TPQ = 96, TPS = TPQ / 4; // ticks per step

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

// tracks: [{ name, notes: [{ t, d, m, v }] }] in steps
export function exportMidi(tracks, bpm) {
  const chunks = [];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length + 1, 0, TPQ];
  const tempo = Math.round(60000000 / bpm);
  const t0 = [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255, 0, 0xff, 0x2f, 0];
  chunks.push(track(t0));
  tracks.forEach((tr, i) => {
    const ev = [];
    for (const n of tr.notes) {
      ev.push([Math.round(n.t * TPS), 0x90 | (i % 16), n.m, Math.round((n.v ?? 0.85) * 127)]);
      ev.push([Math.round((n.t + n.d) * TPS), 0x80 | (i % 16), n.m, 0]);
    }
    ev.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
    const bytes = [0, 0xff, 0x03, ...vlq(tr.name.length), ...[...tr.name].map(c => c.charCodeAt(0) & 0x7f)];
    let last = 0;
    for (const [tick, st, m, v] of ev) { bytes.push(...vlq(tick - last), st, m, v); last = tick; }
    bytes.push(0, 0xff, 0x2f, 0);
    chunks.push(track(bytes));
  });
  function track(b) { const l = b.length; return [0x4d, 0x54, 0x72, 0x6b, (l >>> 24) & 255, (l >> 16) & 255, (l >> 8) & 255, l & 255, ...b]; }
  return new Blob([new Uint8Array([...header, ...chunks.flat()])], { type: 'audio/midi' });
}

// Returns [{ name, notes }] in steps.
export function importMidi(arrayBuffer) {
  const d = new DataView(arrayBuffer);
  let p = 0;
  const u32 = () => { const x = d.getUint32(p); p += 4; return x; };
  const u16 = () => { const x = d.getUint16(p); p += 2; return x; };
  const readVlq = () => { let n = 0, b; do { b = d.getUint8(p++); n = (n << 7) | (b & 0x7f); } while (b & 0x80); return n; };
  p = 8; u16(); const ntr = u16(); const div = u16() || TPQ;
  const scale = 4 / div; // ticks -> steps
  const out = [];
  for (let i = 0; i < ntr; i++) {
    u32(); const len = u32(), end = p + len;
    let tick = 0, status = 0, name = `Track ${i + 1}`;
    const open = new Map(), notes = [];
    while (p < end) {
      tick += readVlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; }
      const type = status & 0xf0;
      if (status === 0xff) {
        const mt = d.getUint8(p++), l = readVlq();
        if (mt === 3) name = new TextDecoder().decode(new Uint8Array(arrayBuffer, p, l));
        p += l;
      } else if (status === 0xf0 || status === 0xf7) { p += readVlq(); }
      else if (type === 0x90 || type === 0x80) {
        const m = d.getUint8(p++), v = d.getUint8(p++);
        if (type === 0x90 && v > 0) open.set(m, { t: tick * scale, m, v: v / 127 });
        else if (open.has(m)) { const n = open.get(m); n.d = Math.max(0.25, tick * scale - n.t); notes.push(n); open.delete(m); }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    if (notes.length) out.push({ name, notes });
  }
  return out;
}

export async function connectMidiInput(onMsg) {
  if (!navigator.requestMIDIAccess) return false;
  try {
    const access = await navigator.requestMIDIAccess();
    const bind = () => { for (const i of access.inputs.values()) i.onmidimessage = e => onMsg(e.data); };
    bind(); access.onstatechange = bind;
    return access.inputs.size;
  } catch { return false; }
}
