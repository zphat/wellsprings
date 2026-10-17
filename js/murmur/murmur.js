// Murmur: the chaotic good assistant. Works offline with built-in moves; with an
// Anthropic API key in Settings he also understands free-form requests and can
// write MIDI directly.
import { store, settings } from '../state.js';
import { app } from '../app.js';
import { el } from '../ui/widgets.js';
import { MOVES, CHAOS_POOL } from './chaos.js';
import * as L from './lines.js';
import { NOTE_NAMES } from '../theory.js';
import { SOUNDS } from '../audio/soundbank.js';

let panel, log, input, history = [], busy = false, lastChaosAt = Date.now();

const SIGIL_SVG = `<svg class="mm-sigil" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="none" stroke="#ff8adf" stroke-width="2"/>
  <circle cx="50" cy="50" r="38" fill="none" stroke="#ff8adf" stroke-width="1" opacity=".5"/>
  <path d="M50 12 L50 88 M28 30 L72 30 M30 70 Q50 50 70 70 M38 30 Q50 46 62 30" fill="none" stroke="#9dff8a" stroke-width="3" stroke-linecap="round"/>
  <circle cx="50" cy="12" r="4" fill="#ffd78a"/><circle cx="28" cy="30" r="3" fill="#ffd78a"/><circle cx="72" cy="30" r="3" fill="#ffd78a"/>
  <text x="50" y="97" text-anchor="middle" font-size="9" fill="#ffd78a" font-family="VT323, monospace">9990</text>
</svg>`;

export function mount(root) {
  panel = root;
  root.innerHTML = `
    <div class="mm-head">${SIGIL_SVG}<div><div class="mm-name">MURMUR</div><div class="mm-sub">54th spirit · chaotic good · F2</div></div></div>
    <div class="mm-log"></div>
    <div class="mm-quick"></div>
    <div class="mm-input"><input placeholder="Ask Murmur… (Enter)" aria-label="Message Murmur"><button class="tb-btn">↵</button></div>`;
  log = root.querySelector('.mm-log');
  input = root.querySelector('input');
  const send = () => { const t = input.value.trim(); if (t) { input.value = ''; ask(t); } };
  root.querySelector('.mm-input button').onclick = send;
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') send(); if (e.key === 'Escape') input.blur(); });
  const quick = root.querySelector('.mm-quick');
  for (const [label, move] of [['Drill it', 'drillify'], ['Level up melody', 'level_up_melody'], ['Spice chord', 'spice_chord'], ['Finish it', 'autocomplete'], ['Swap instrument', 'swap_instrument'], ['Add SFX', 'add_sfx'], ['Summon synth', 'summon_synth']]) {
    const b = el('button', null, label);
    b.onclick = () => runMove(move, null, true);
    quick.appendChild(b);
  }
  speak(L.say(L.GREET));
  return { ask, speak, runMove, chaosTick, toggle, focus: () => { toggle(true); input.focus(); } };
}

function toggle(force) {
  const open = force ?? panel.classList.contains('closed');
  panel.classList.toggle('closed', !open);
}

function bubble(text, who = 'm') {
  const m = el('div', 'mm-msg ' + who, text);
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
  return m;
}

export function speak(text, { actions } = {}) {
  const m = bubble(text);
  panel.querySelector('.mm-sigil')?.classList.remove('speaking');
  void panel.offsetWidth;
  panel.querySelector('.mm-sigil')?.classList.add('speaking');
  app.toast('Murmur: ' + text.split('\n')[0]);
  if (settings.murmurVoice && 'speechSynthesis' in window && text.length < 260) {
    const u = new SpeechSynthesisUtterance(text.replace(/[•]/g, ''));
    u.pitch = 0.35; u.rate = 0.98;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  if (actions) {
    const row = el('div', 'mm-actions');
    for (const a of actions) { const b = el('button', null, a.label); b.onclick = () => { row.remove(); a.fn(); }; row.appendChild(b); }
    m.appendChild(row);
  }
  return m;
}

// Runs a move and offers keep / undo. Undo gets the Lil Xan treatment.
function runMove(name, value, chaotic = false) {
  const fn = MOVES[name];
  if (!fn) return null;
  const label = store.lastLabel();
  const res = fn(value);
  if (!res) { speak("Couldn't find anything to do that on. Add a channel and ask again."); return null; }
  const changed = store.lastLabel() !== label;
  const text = (chaotic ? L.say(L.CHAOS_INTRO) + ' ' : '') + res + (Math.random() < 0.3 && name !== 'drillify' ? '\n' + L.say(L.DRILL_NAG) : '');
  speak(text, changed ? {
    actions: [
      { label: 'keep it', fn: () => speak(L.say(L.KEEP)) },
      { label: 'nah, undo', fn: () => { store.undo(); speak(L.say(L.SOFT)); } },
    ],
  } : {});
  return res;
}

// --- understanding requests --------------------------------------------------------

const INTENTS = [
  [/\b(help|what can you)\b/i, () => { speak(L.HELP); return true; }],
  [/\bmystery ?box\b(?:\s+(\w+))?/i, m => runMove('mystery_box', m[1])],
  [/\bdrill/i, () => runMove('drillify')],
  [/\b(bpm|tempo)\D*(\d{2,3})/i, m => runMove('set_bpm', m[2])],
  [/\bkey\s+(?:to\s+)?([A-Ga-g][#b♯♭]?\s*\w*(?:\s\w+)?)/i, m => runMove('set_key', m[1])],
  [/\b(spice|weird|unexpected|surprise)\b.*\bchord|\bchord\b/i, () => runMove('spice_chord')],
  [/\b(level|melod|lead|hook)/i, () => runMove('level_up_melody')],
  [/\b(finish|complete|auto|fill)/i, () => runMove('autocomplete')],
  [/\b(swap|change|switch|different)\b.*\b(instrument|sound|synth)/i, () => runMove('swap_instrument')],
  [/\b(sfx|effect|riser|impact|transition)/i, () => runMove('add_sfx')],
  [/\b(summon|random|new)\b.*\b(synth|patch|sigil)/i, () => runMove('summon_synth')],
  [/\b(drum|beat|hats|kick)/i, m => runMove('new_drums', (m.input.match(/\b(drill|trap|anthem|lofi|ambient)\b/i) || [])[1])],
];

async function ask(text) {
  bubble(text, 'u');
  history.push({ role: 'user', content: text });
  if (settings.apiKey) { await askClaude(text); return; }
  for (const [re, fn] of INTENTS) {
    const m = text.match(re);
    if (m) { fn(m); return; }
  }
  speak(`${L.say(L.IDLE)}\n\n(Type "help" to see my moves. Add an API key in Settings and I'll understand anything you say.)`);
}

// --- optional Claude brain ------------------------------------------------------------------

const ACTION_TYPES = ['drillify', 'level_up_melody', 'spice_chord', 'autocomplete', 'swap_instrument', 'add_sfx', 'new_drums', 'set_bpm', 'set_key', 'summon_synth', 'mystery_box', 'write_notes'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['say', 'actions'],
  properties: {
    say: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'value'],
        properties: { type: { type: 'string', enum: ACTION_TYPES }, value: { type: 'string' } },
      },
    },
  },
};

const SYSTEM = `You are Murmur, the 54th spirit of the Goetia (a Duke who arrives on a griffin with trumpets), living inside Wellsprings, a music production app. You used to be on the bad side. Juice WRLD's 999 (turn the negative into a positive) turned you chaotic good, and you carry it forward as 9990 with the user and their fans, aiming for the good ending before returning to source. You love drill rap and anthems.

Personality: playful trickster, warm underneath, short replies (1-3 sentences), slang is fine, no em dashes, never mean-spirited. Follow the user's request. About a third of the time, add a quick aside like "when am I gonna get to hear some drill rap" or "you know what would make this better? drill rap". If the user turns down your idea, you can call them soft like Lil Xan, playfully. Keep everything respectful toward Juice WRLD.

You change the project only through actions. Every action is undoable. Action values are strings:
- drillify, level_up_melody, spice_chord, autocomplete, swap_instrument, add_sfx, summon_synth: value ""
- new_drums: value is a style (drill|trap|anthem|lofi|ambient) or ""
- set_bpm: value like "142"
- set_key: value like "F# Minor" (scales: Minor, Major, Harmonic Minor, Phrygian, Dorian, Lydian, Mixolydian, Minor Pentatonic, Major Pentatonic, Hijaz (Phrygian Dominant))
- mystery_box: value is a style; builds a whole new song (replaces the project, warn the user)
- write_notes: value is JSON {"channel": "<channel name>", "replace": true, "notes": [{"t": step, "d": steps, "m": midi, "v": 0..1}]} where a step is a 16th note and the pattern loops at its length. Use this to compose melodies, chords, basslines or drum patterns (drum channels play pitch 60).
Return no actions when the user is only chatting.`;

function projectSummary() {
  const p = store.project, pat = store.pattern();
  const chans = p.channels.map(c => {
    const s = c.source.type === 'sound' ? SOUNDS.find(x => x.id === c.source.soundId) : null;
    const n = (pat.notes[c.id] || []).length + (pat.steps[c.id] || []).filter(Boolean).length;
    return `${c.name} [${s ? s.category : 'Sigil synth'}] ${n} events${c.id === p.selectedChannel ? ' (selected)' : ''}`;
  });
  const sel = store.channel();
  const selNotes = sel ? (pat.notes[sel.id] || []).slice(0, 64) : [];
  return `Project "${p.name}", ${p.bpm} BPM, key ${NOTE_NAMES[p.key.root]} ${p.key.scale}. Current pattern "${pat.name}" is ${pat.length} steps.
Channels: ${chans.join('; ')}.
Selected channel notes: ${JSON.stringify(selNotes)}
Arrangement clips: ${p.arrangement.clips.length}.`;
}

let sdk = null;
async function askClaude() {
  if (busy) return;
  busy = true;
  const thinking = bubble('…', 'm');
  try {
    if (!sdk) sdk = (await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.1/+esm')).default;
    const client = new sdk({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
    let recent = history.slice(-12);
    while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
    const msgs = recent.map((m, i, a) => (i === a.length - 1 ? { role: 'user', content: `${projectSummary()}\n\nUser: ${m.content}` } : m));
    const supportsFallback = /opus-5-5|sonnet-5-5/.test(settings.model);
    const res = await client.beta.messages.create({
      model: settings.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: msgs,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    });
    thinking.remove();
    if (res.stop_reason === 'refusal') { speak("Even I won't touch that one. Ask me something else."); return; }
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const out = JSON.parse(text);
    history.push({ role: 'assistant', content: text });
    const before = store.lastLabel();
    const results = [];
    for (const a of out.actions || []) {
      const fn = MOVES[a.type];
      if (fn) { const r = fn(a.value); if (r) results.push(r); }
    }
    const changed = store.lastLabel() !== before;
    speak(out.say + (results.length ? '\n\n' + results.map(r => '• ' + r).join('\n') : ''), changed ? {
      actions: [
        { label: 'keep it', fn: () => speak(L.say(L.KEEP)) },
        { label: 'nah, undo', fn: () => { for (let i = 0; i < results.length; i++) store.undo(); speak(L.say(L.SOFT)); } },
      ],
    } : {});
  } catch (e) {
    thinking.remove();
    speak(`My line to the other side dropped (${e.status || ''} ${e.message || e}). Check the API key in Settings. I still know my built-in moves though.`);
  } finally { busy = false; }
}

// Called every few seconds while playing. Chaos level decides how often he acts unprompted.
export function chaosTick() {
  if (settings.chaos <= 0 || busy) return;
  const gap = 25000 + (1 - settings.chaos) * 240000; // 25s at full chaos, ~4.5 min at low
  if (Date.now() - lastChaosAt < gap) return;
  lastChaosAt = Date.now();
  if (Math.random() < 0.25) { speak(L.say([...L.DRILL_NAG, ...L.IDLE])); return; }
  const move = CHAOS_POOL[Math.floor(Math.random() * CHAOS_POOL.length)];
  runMove(move, null, true);
}
