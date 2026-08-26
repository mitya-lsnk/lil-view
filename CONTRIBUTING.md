# Contributing to lil view

Thanks for taking the time to contribute! This is a small project, so the process is
light.

## Getting set up

You'll need **macOS 12+**, **Node ≥ 20** and **Rust** (stable). Then:

```bash
npm install
npm run tauri dev
```

The frontend alone (`npm run dev`) opens in a plain browser, but almost nothing works
there: decoding, folder listing and file operations all live on the Rust side, and the
`limg://` protocol only exists inside the Tauri app.

## Before you open a PR

Run the checks CI runs:

```bash
npx tsc --noEmit                          # type-check the frontend
npm run build                             # production frontend build
cd src-tauri && cargo test                # Rust tests
cd src-tauri && cargo clippy              # and keep it warning-free
```

## Code style

- Match the surrounding code — naming, comment density, and idiom. Comments explain
  *why*, not *what*: the interesting comments here record a trap someone already fell
  into.
- TypeScript is strict; keep it that way. No `any` where a real type fits.
- Keep components focused; shared logic goes in `src/lib/`.

## Translations (i18n)

All user-facing text lives in [`src/lib/strings.tsx`](src/lib/strings.tsx), in two
dictionaries: `RU` and `EN`. `EN` is typed against `RU`, so adding a key to one language
makes the compiler require it in the other — a missing or renamed key is a build error,
not a silent gap.

## Touching image loading

Two things in this codebase will bite you if you change them without knowing why:

- **Image bytes go through the `limg://` protocol, not IPC.** Tauri serialises `Vec<u8>`
  as a JSON array of numbers; a 40 MB photo becomes tens of megabytes of text. If you
  find yourself returning bytes from a command, look at
  [`proto.rs`](src-tauri/src/proto.rs) first.
- **LaunchServices lies.** It reports success for calls the system then ignores, so
  [`assoc.rs`](src-tauri/src/assoc.rs) re-queries every type after writing it. Don't
  replace that with a bare success check.

## Commits & PRs

- Write clear commit messages; describe the *why* in the body when it isn't obvious.
- One logical change per PR where practical.
- Describe what you changed and how you tested it.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
