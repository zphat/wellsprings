// Start-up question: how deep do you want to go?
import { store, settings, saveSettings, newProject } from '../state.js';
import { app } from '../app.js';
import { el } from './widgets.js';
import { SOUNDS, categories } from '../audio/soundbank.js';
import { buildSong, LANE_ROLES, STYLES } from '../generate.js';
import { pickSound } from '../murmur/chaos.js';

export function openOnboarding() {
  const back = el('div', 'modal-back');
  const m = el('div', 'modal');
  back.appendChild(m);
  document.getElementById('modal-root').appendChild(back);
  const close = () => back.remove();

  m.innerHTML = `<h1>WELLSPRINGS</h1>
    <p class="muted">A grimoire for making music. Murmur, the 54th spirit, is riding shotgun. He's chaotic good now. Mostly.</p>
    <h3>How deep do you want to go today?</h3>`;
  const depth = el('div', 'depth');
  const opts = [
    ['mystery', 'Mystery Box', 'Pick a vibe, Murmur builds a whole track: drums, 808, chords, melody, arrangement. Hit space. Everything stays editable.'],
    ['mashup', 'MIDI Mashup', 'You choose the instrument for each lane, Murmur generates editable MIDI that fills the piano roll for every one of them.'],
    ['roll', 'Piano Roll', 'Blank page, starter kit loaded. You write every note. Murmur only speaks when spoken to (unless you turn chaos up).'],
  ];
  let choice = settings.depth || 'mystery';
  const detail = el('div');
  for (const [k, title, text] of opts) {
    const b = el('button', choice === k ? 'active' : '');
    b.innerHTML = `<b>${title}</b><span class="muted">${text}</span>`;
    b.onclick = () => { choice = k; depth.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderDetail(); };
    depth.appendChild(b);
  }
  m.appendChild(depth);
  m.appendChild(detail);

  let style = 'drill';
  const lanes = LANE_ROLES.map(role => ({ role, pick: 'auto' }));

  function styleRow() {
    const r = el('div', 'row');
    r.appendChild(el('span', 'muted', 'Vibe:'));
    for (const s of Object.keys(STYLES)) {
      const b = el('button', 'tb-btn' + (s === style ? ' on' : ''), s);
      b.onclick = () => { style = s; renderDetail(); };
      r.appendChild(b);
    }
    return r;
  }

  function renderDetail() {
    detail.innerHTML = '';
    if (choice === 'mystery') {
      detail.appendChild(styleRow());
    } else if (choice === 'mashup') {
      detail.appendChild(styleRow());
      const box = el('div', 'lanes');
      box.style.marginTop = '10px';
      const cats = categories().filter(c => !['Kicks', 'Snares', 'Claps', 'Hats', 'Percussion', 'FX'].includes(c));
      lanes.forEach(l => {
        const row = el('div', 'lane');
        row.appendChild(el('span', null, l.role));
        const s = el('select');
        const add = (v, t) => { const o = el('option', null, t); o.value = v; s.appendChild(o); };
        add('auto', l.role === 'Drums' ? 'Murmur picks a kit' : 'Murmur picks');
        add('off', '(leave this lane out)');
        if (l.role !== 'Drums') {
          add('sigil', 'Sigil synth (random patch)');
          for (const c of cats) {
            const og = el('optgroup'); og.label = c;
            for (const snd of SOUNDS.filter(x => x.category === c)) { const o = el('option', null, snd.name); o.value = snd.id; og.appendChild(o); }
            s.appendChild(og);
          }
        }
        s.value = l.pick;
        s.onchange = () => (l.pick = s.value);
        row.appendChild(s);
        box.appendChild(row);
      });
      detail.appendChild(box);
    } else {
      detail.appendChild(el('p', 'muted', 'You get a kick, snare, hat, 808 and a Sigil synth in the rack. Press F1 any time for the codex.'));
    }
    const go = el('div', 'row');
    go.style.marginTop = '16px';
    const btn = el('button', 'cta', choice === 'mystery' ? 'Open the box' : choice === 'mashup' ? 'Generate the MIDI' : 'Open the grimoire');
    btn.onclick = async () => {
      await app.ensureAudio();
      settings.depth = choice; saveSettings();
      const seed = Math.floor(Math.random() * 99990);
      if (choice === 'roll') store.load(newProject());
      else {
        const p = newProject();
        const laneSpec = choice === 'mashup' ? lanes.filter(l => l.pick !== 'off').map(l => ({
          role: l.role,
          source: l.pick === 'auto' ? null : l.pick === 'sigil' ? { type: 'plugin', pluginId: 'sigil', state: null } : { type: 'sound', soundId: l.pick },
        })) : null;
        buildSong(p, { style, seed, lanes: laneSpec, pickSound });
        store.load(p);
      }
      close();
      app.show('pattern');
      const mm = app.murmur;
      if (choice === 'mystery') mm.speak(`Mystery box: "${store.project.name}". ${style}, ${store.project.bpm} BPM, seed ${seed}. Space to play. F5 to see the arrangement.${style !== 'drill' ? ' Not drill, but I respect it.' : ' Drill. You get me.'}`);
      else if (choice === 'mashup') mm.speak(`Every lane has MIDI now. Click a channel name in the rack to see its notes in the piano roll. Change anything.`);
      else mm.speak(`Blank page. Play with A through ', octaves on the arrows, chords on the number row. I'm here if you need me.`);
    };
    const skip = el('button', 'cta alt', 'Not now');
    skip.onclick = close;
    go.append(btn, skip);
    detail.appendChild(go);
  }
  renderDetail();
}
