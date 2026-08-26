# lil view

**English** · [Русский](README.ru.md)

A fast image viewer for macOS. Open one picture, page through the whole folder. It
reads HEIC, TIFF, PSD and camera RAW through the system's own ImageIO, so there are no
third-party decoders and nothing leaves your machine — the app makes no network
connections at all. See [What goes over the network](#what-goes-over-the-network).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)
![Platforms](https://img.shields.io/badge/platform-macOS%2012%2B-555)

Part of the **lil** set — small local tools that each do one thing:

| | |
|---|---|
| [lil edit](https://github.com/mitya-lsnk/lil-edit) | reshape it: compress, cut out the background, upscale |
| **lil view** | look at it: a fast macOS image viewer — you are here |
| [lil download](https://github.com/mitya-lsnk/lil-download) | fetch it: video and audio from anywhere yt-dlp reaches |

---

## Install

Grab a build from [Releases](../../releases), or build it yourself (below).

The app isn't signed: right-click it → **Open** the first time. Put it in
`/Applications` before setting file associations — macOS binds a handler to one
specific copy of the bundle, so an app run from `~/Downloads` will lose the association
the moment it moves.

---

## What works

| Feature | Status | How |
|---|---|---|
| **Paging a folder** | ✅ done | Arrow keys and the wheel, natural sort, no import step |
| **Zoom & pan** | ✅ done | One CSS transform on the stage — no re-decode per step |
| **Filmstrip & grid** | ✅ done | Thumbnails along the edge, or the whole folder at once |
| **Wide format support** | ✅ done | HEIC, TIFF, PSD and camera RAW via system ImageIO |
| **Slideshow & EXIF** | ✅ done | Timed advance; a metadata panel beside the picture |
| **File operations** | ✅ done | Trash, move, copy to clipboard, convert |
| **Default-app switch** | ✅ done | One button that claims every image type at once, via LaunchServices |
| **Interface language** | ✅ done | Russian / English, switchable in-app |
| **Theming** | ✅ done | Four skins × light/dark, shared with the rest of the set |

---

## Two decisions worth knowing about

**Image bytes never go through IPC.** Tauri serialises a `Vec<u8>` as a JSON array of
numbers — for a 40 MB photograph that is tens of megabytes of text on every open.
Instead the app registers its own URI scheme, `limg://`, and `<img src>` pulls the data
the way it pulls any other resource. Formats WebKit reads natively are handed over as
the file itself, untouched.

**File associations are read back after they're written.** LaunchServices reports
success for calls the system then ignores. So [`assoc.rs`](src-tauri/src/assoc.rs)
re-queries every type after setting it and shows the result line by line, rather than
claiming a win it can't verify.

---

## Interface language

The UI ships in **Russian and English**, switchable from the header. All user-facing
text lives in [`src/lib/strings.tsx`](src/lib/strings.tsx) — add a key to the `RU`
object and the compiler will require the matching `EN` value, so a missing translation
is a build error rather than a blank label.

---

## Tech stack

- **Tauri 2** — shell (Rust backend + system WebView). Light, ~10 MB runtime.
- **React + TypeScript + Vite** — frontend.
- **ImageIO** — the system decoder, reached through a thin Rust bridge. Everything macOS
  can open, lil view can open, with no bundled codecs.

---

## Getting started

Requires macOS 12+, Node ≥ 20 and Rust.

```bash
npm install          # first time only
npm run tauri dev    # run the app in dev mode
```

Build a release `.app`:

```bash
npm run tauri build -- --bundles app
```

---

## What goes over the network

**Nothing.** There is no update check, no telemetry, no analytics, no crash reporting
and no account. The app opens no connections of its own — the only traffic it can cause
is a link you click, which opens in your browser and not in the app.

---

## Project structure

```
lil-view/
├── src/                        # frontend (React)
│   ├── theme.css               # semantic tokens (shared across the lil set)
│   ├── skins.css               # studio / brutal / riso / device
│   ├── dark.css                # dark variants per skin
│   ├── viewer.css              # viewer layout
│   ├── lib/
│   │   ├── limg.ts             # the limg:// bridge
│   │   ├── folder.ts           # folder listing and navigation
│   │   ├── settings.ts         # what the app remembers
│   │   ├── i18n.tsx            # language context (RU/EN)
│   │   ├── skin.tsx            # skin + light/dark
│   │   └── strings.tsx         # all UI text, both languages
│   └── components/
│       ├── Stage.tsx           # zoom and pan in a single transform
│       ├── Filmstrip.tsx       # thumbnails along the edge
│       ├── GridView.tsx        # the whole folder at once
│       ├── InfoPanel.tsx       # EXIF
│       ├── AssocCard.tsx       # the default-app switch, verified per type
│       └── SettingsScreen.tsx
└── src-tauri/
    └── src/
        ├── proto.rs            # the limg:// protocol — bytes bypass IPC
        ├── imageio.rs          # bridge to ImageIO: decode, encode, metadata
        ├── assoc.rs            # file associations via LaunchServices
        ├── scan.rs             # folder listing and natural sort
        ├── exif.rs             # metadata for the info panel
        └── fileops.rs          # trash, move, clipboard, convert
```

---

## Roadmap / known limits

- **macOS only.** ImageIO is the whole point — it's what makes RAW and PSD work without
  bundling a decoder — and it doesn't exist elsewhere. A cross-platform build would be a
  different program.
- **No editing.** That's [lil edit](https://github.com/mitya-lsnk/lil-edit)'s job.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 lsnk
