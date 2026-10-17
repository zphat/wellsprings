# Wellsprings

An open-source music production app built as a digital grimoire. You make beats
FL Studio style, with patterns, a channel rack, a piano roll, a playlist and a mixer. Murmur rides along with you. He's the 54th spirit of the Goetia, he's chaotic good now, and he really wants to hear some drill.

Made with good intention. Wherever a 666 might have gone, 9990 is there instead:
the default random seed is 9990, the dev server runs on port 9990, and the screen glitches every 9990 ms.

## Run it

You need Python only for a tiny local web server. Nothing to install, no build step.

```bash
python -m http.server 9990 --bind 127.0.0.1
```

Then open http://localhost:9990 in Chrome or Edge. (Opening `index.html` straight
from disk won't work, because browsers block ES modules on `file://`.)

## What's in it

| Area | What you get |
|---|---|
| **Start-up** | You pick how deep to go. **Mystery Box** means Murmur builds a whole editable track. **MIDI Mashup** means you choose an instrument per lane and get editable MIDI for every lane. **Piano Roll** is a blank page. |
| **Pattern screen (F6)** | A channel rack step sequencer and a piano roll. The roll bends, breathes and splits its colours a little, on purpose, and clicks still land exactly where you see a note. Key highlight, snap-to-key, a velocity lane, ghost notes from other channels. You can set the warp to straight, gentle, full or possessed. |
| **Playlist (F5)** | Paint patterns and audio clips onto 12 tracks, with waveforms, loop region, drag-and-drop audio import. It never warps. |
| **Mixer (F9)** | A master bus and 16 inserts. Each has an 8-slot FX chain, pan, fader, mute and a peak meter. |
| **Sound Bank (F8)** | 200 original sounds, all synthesized in code: 90 drums, 808s, percussion and FX, plus 110 tonal sounds across 8 categories. |
| **Library (F3)** | Every render and saved version of every track, with the latest marked ★. It has playlists, a player, shuffle, and a big Stream Mode now-playing screen you can capture in OBS. |
| **Murmur (F2)** | Works offline: drill-ify, level up the melody, spice chord, finish the track, swap instrument, add SFX, new drums, tempo/key, summon a synth, mystery box. Add an Anthropic API key in Settings and he understands anything you type and can write MIDI himself. The chaos slider sets how often he acts unprompted. Every move is one Ctrl+Z away, and undoing one gets you called soft like Lil Xan. |
| **Files** | Save versions (Ctrl+S), render 24-bit WAV (Ctrl+E), export or import MIDI, export or import `.wellspring` project files, and play from a Web MIDI keyboard. |

### The plugins

| Plugin | What it is |
|---|---|
| **Sigil** | A polyphonic synth: 2 oscillators, sub, noise, filter, 2 envelopes, LFO, glide, drive and width. **Summon** makes weighted random patches from 8 archetypes, so they're varied and pleasant rather than noise. It has 8 factory presets, and you can save your own. |
| **Abyss** | A reverb with 10 algorithms: Cathedral of Nine, Astral Hall, Gold Plate, Velvet Chamber, Small Temple Room, Spring of Hermes, Shimmer Ascension, Gated Sigil, Reverse Veil and Void. |
| **Ouroboros** | A delay with stereo, ping-pong, mono and tape modes, tempo sync including dotted and triplet values, filtered and saturated feedback, and wow/flutter. |
| **Halo** | A one-knob enhancer. It isn't a plain bass boost. It does psychoacoustic bass (harmonics that make lows audible on phone speakers), a mud cut and a presence lift, an Aphex-style air exciter and gentle glue, then matches loudness so "better" doesn't just mean "louder". |
| **Seal** | An Ozone-style mastering suite: 4-band EQ, 3-band multiband compression, a per-band stereo spreader with mono-bass, an exciter and a maximizer with a ceiling. It has 5 presets, including Drill Night, Stream Safe and 9990 Good Ending. |
| **Basics** | Tri-Seal EQ, Binding Compressor, Veil Filter and Utility (gain, width, mono, polarity). |

## Keys

| Keys | What they do |
|---|---|
| `A S D F G H J K L ; '` | White keys |
| `W E` · `T Y U` · `O P` · `]` | Black keys. They sit above the gaps like a piano, and `Q` is the B♭ just below. |
| `Z`…`/` | White keys one octave down |
| `↑` / `↓` | Change octave |
| `←` / `→` | Select the previous or next channel |
| `1`…`0` | Play ten chords that fit the key |
| `Shift`+number | Play Murmur's spice chords |
| `Ctrl`+number | Stamp a chord into the roll |
| `Space` | Play / pause |
| `Ctrl+L` | Switch between pattern and song mode |
| `Ctrl+R` | Record |
| `F1`–`F10` | Open each window (F6 is the pattern screen, as in FL) |

## VST support: what's real today and the plan

This first version runs in the browser on Web Audio, so it can't host third-party
VST3 or AU plugins. Browsers have no way to load native plugin binaries. Every
built-in instrument and effect follows one plugin contract
(`docs/PLUGIN_CONTRACT.md`), and the DSP is kept simple enough to port.

Roadmap to a native, VST-capable Wellsprings:

1. **Desktop shell.** Wrap this UI in Tauri. This is the same plan as Sundial.
2. **Native audio engine in Rust.** Use `cpal` for audio I/O and move the scheduler and mixer into Rust. The UI keeps talking to it through the same project JSON.
3. **Plugin hosting.** Host CLAP through `clack-host` and VST3 through the VST3 SDK (it's GPL3/proprietary dual-licensed, so pick the open-source license on purpose). Plugin editors open in their own native windows.
4. **Ship the built-ins as real plugins.** Port Sigil, Abyss, Ouroboros, Halo and Seal to `nih-plug` (Rust). It exports VST3 and CLAP from one codebase, so other DAWs can use them too.

## Project layout

```
index.html, css/style.css
js/main.js            boot, top bar, transport, file I/O
js/state.js           project model, undo/redo, settings
js/audio/engine.js    graph, scheduler, offline render
js/audio/soundbank.js the 200 sounds
js/plugins/           sigil, abyss, ouroboros, halo, seal, basics
js/ui/                pattern (rack + roll), playlist, mixer, browser, library, settings, onboarding
js/murmur/            murmur (panel + optional Claude brain), chaos (his moves), lines (his voice)
js/generate.js        drums, progressions, basslines, melodies, whole songs
js/io/                IndexedDB library, WAV encoder, MIDI files
```

## Privacy

Projects, samples and renders stay in your browser (IndexedDB). The optional API
key is stored in localStorage and sent only to api.anthropic.com when you talk to
Murmur.

## License

MIT
