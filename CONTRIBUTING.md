# Contributing to Wellsprings

Wellsprings is open source and for everyone. PRs, sounds, presets, bug reports
and weird ideas are all welcome.

## Run it from source

The app is plain ES modules. There's no bundler and no build step for the UI.

```bash
python -m http.server 9990 --bind 127.0.0.1 --directory web
```

Then open http://localhost:9990. Changes show up on reload.

To run or build the desktop app you need [Rust](https://rustup.rs), Node 20+
and, on Windows, the Visual Studio C++ Build Tools (Tauri's prerequisites page
has the exact list):

```bash
npm install
npm run dev     # desktop window with the web UI
npm run build   # installer in src-tauri/target/release/bundle
```

You don't need a local toolchain to ship. Every push to `main` builds the Windows
installer on GitHub Actions (look under the run's Artifacts), and pushing a
`vX.Y.Z` tag publishes a release.

## Where things live

| Path | What |
|---|---|
| `web/js/audio/engine.js` | Audio graph, scheduler, offline render |
| `web/js/audio/soundbank.js` | The 220 original sounds (all synthesized) |
| `web/js/plugins/` | Instruments and effects. Follow `docs/PLUGIN_CONTRACT.md` |
| `web/js/generate.js` | Mystery Box: styles, vibes, drums, harmony, melodies, arrangement |
| `web/js/murmur/` | Murmur: his moves (`chaos.js`), his voice (`lines.js`), AI providers |
| `web/js/ui/` | Screens: pattern/piano roll, playlist, mixer, sound bank, library |
| `src-tauri/` | Desktop shell (Rust). The future home of the native engine and VST/CLAP hosting |

## House rules

- **Good intention.** The theme is occult and esoteric, but the spirit is kind.
  Anywhere a 666 might go, use 9990.
- **The piano roll warp stays on.** It's the point. Making it calmer is fine;
  making it straight isn't. Clicks must always land on the note you see. If you
  change `off()` in `pattern.js`, keep `unwarp()` able to invert it.
- **Every Murmur move must be undoable.** Go through `app.change()` / `store.mutate()`.
- **No samples you don't own.** Sounds in the bank are generated in code. User
  samples stay on the user's machine.
- **Murmur is respectful about Juice WRLD.** Roasts are playful (soft like Lil Xan),
  never cruel.

## Adding a style to the Mystery Box

1. Add an entry to `STYLES` in `web/js/generate.js` (tempo range, scales, sound categories, chord rhythm, Seal preset, reverb).
2. Add drum grids to `GRIDS` (one character per 16th: `x` hit, `o` ghost, `.` rest).
3. Add words to `STYLE_WORDS` so the vibe box recognises it.
4. Try it with `buildSong(newProject(), { style: 'yourstyle', seed: 9990 })` in the console.
