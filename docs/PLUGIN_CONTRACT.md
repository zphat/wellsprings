# Plugin contract (Web Audio, v0)

Plain ES modules, no dependencies, no build step. Every plugin file lives in
`js/plugins/` and exports:

```js
export const meta = { id: 'abyss', name: 'Abyss', kind: 'fx' | 'instrument', description: '...' };
export function create(ctx /* AudioContext or OfflineAudioContext */, state /* optional saved getState() */) { return plugin; }
```

## FX plugin object

```js
{
  id, name, kind: 'fx',
  input: AudioNode,          // engine connects source -> input
  output: AudioNode,         // engine connects output -> next
  getState(): object,        // plain JSON, round-trips through setState
  setState(obj): void,
  set(key, value): void,     // single param change, applied to audio immediately (use setTargetAtTime to avoid zipper noise)
  renderUI(container: HTMLElement): void,  // build controls with js/ui/widgets.js (knob, select, toggle, button, section, meter, el)
  setTempo?(bpm): void,      // engine calls on tempo change (delay sync)
  dispose(): void,
}
```

`create` must work with an OfflineAudioContext too (WAV export renders the
whole project offline), so no `requestAnimationFrame`, no `ctx.resume()`, and
no async IR loading at create time. Generate impulse responses synchronously
with `ctx.createBuffer`.

## Instrument plugin object

```js
{
  id, name, kind: 'instrument',
  output: AudioNode,
  noteOn(midi, velocity /*0..1*/, time /*ctx seconds*/): void,
  noteOff(midi, time): void,
  playNote(midi, velocity, time, duration): void,   // schedule on+off
  allNotesOff(time?): void,
  getState(), setState(obj), set(key, value), renderUI(container), dispose(),
}
```

Voices must be created per note and garbage collected after release (stop
oscillators, disconnect on `onended`). Cap polyphony at 24 voices.

## Seeded randomness

Use `mulberry32(seed)` from `js/audio/rng.js`. The default seed anywhere a
seed is needed is **9990**.

## Styling

Widget classes are `gk-*` and styled globally in `css/style.css`. A plugin
window root gets class `gk-plugin` plus `gk-plugin-<id>`; plugins may add a
small `<style>` block scoped to `.gk-plugin-<id>` for their own look.
