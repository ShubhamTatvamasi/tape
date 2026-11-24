# Tape — a private screen recorder for the browser

**Tape** records a screen, window or tab entirely inside the browser. Pick an output size,
record narration over system sound, pause, stop, and save the file — nothing is uploaded,
there is no account, and there is no watermark.

Live at `https://shubhamtatvamasi.com/tape/`.

Built with **Astro + Svelte**, deployed as a static site by **GitHub Actions**.

---

## Why "Tape"?

Short, memorable, and it frames the act of recording as taking a physical copy — which is
exactly the pitch: the recording stays with you.

The app name, package name, and repository name are all **Tape**, so the public URL is simply
`/tape/`. There is no separate codename to explain.

---

## What it does

- **Screen, window or tab capture** through `getDisplayMedia()`, with hints for the browser's
  source picker (Screen / Window / Tab / Ask me).
- **Output size presets** — Source, 4K, QHD, Full HD, HD, SD, plus custom width × height.
  The selected size is a bounding box, because browsers never crop or upscale a shared display.
  The real captured resolution is shown while recording.
- **Frame rate** — 24 / 30 / 60 fps, decimated by the browser when the source cannot keep up.
- **Audio** — system/tab audio and microphone, mixed into one track with the Web Audio API.
  Microphone gain, live level meter and a mute button.
- **Pause & resume**, a countdown, a live timer, and a running file-size readout.
- **Play overlay and preview** — a large play affordance on the finished take, a poster frame,
  and native controls once playback starts.
- **Mobile-aware saving** — a share-sheet action when the browser supports sharing files, so
  recordings can be sent to Files, Photos or another app.
- **MP4 or WebM**, chosen from what the browser can actually encode (`MediaRecorder.isTypeSupported`).
  Auto prefers MP4 for sharing; WebM is the reliable fallback.
- **Two save modes**
  - *In memory* (default): chunks are held in the tab, then a preview and a Save button appear.
  - *Write to disk*: on Chromium, chunks stream straight into a file you pick, so memory stays flat.
- **Preview & takes** — a native player, a poster frame, a session take list, download/delete.
- **Local-first details** — wake lock while recording, a reload guard, keyboard shortcuts,
  a privacy-first page with no analytics or third-party calls.

## The interesting engineering bits

### The recording is the raw display stream

A tempting approach is to draw every frame into a `<canvas>` and record the canvas, so you can
crop/scale/composite overlays. It breaks the moment the user switches tabs: `requestAnimationFrame`
is suspended, the canvas freezes, and `captureStream()` keeps sampling the frozen pixels. Screen
recorders are switched away from by definition.

Tape records the `MediaStream` handed back by `getDisplayMedia()` directly. Size is applied with
capture constraints (`width`/`height` act as a bounding box and the browser downscales
aspect-preserving). That means the recording keeps running while the user is in another app —
which is the entire point.

### Exact output size vs. aspect ratio

`width`/`height` in `getDisplayMedia` are ceilings, and the spec forbids cropping. Picking
"1920 × 1080" on a 16:10 display gives 1728 × 1080, not 1920 × 1080. The UI reports the actual
size instead of pretending otherwise. Custom width/height behaves the same way.

### Audio mixing

`MediaRecorder` records only the first audio track it is given, so system audio and mic are summed
through an `AudioContext` → `GainNode` → `AnalyserNode` → `MediaStreamAudioDestinationNode` graph.
The `AudioContext` is created synchronously inside the start click, before any `await`, otherwise
autoplay policy can leave the graph suspended and the recording silent.

### Format selection

MP4 is preferred when the platform exposes an H.264 encoder (Safari, most Chrome/Edge installs),
and WebM (VP9 → VP8) is the fallback. A 1-second `start(1000)` timeslice keeps memory bounded and
also avoids the Safari MP4 freeze that appears when no timeslice is passed.

### Saving

- Memory: 1-second chunks are reassembled into a `Blob`; a poster frame is grabbed from the finished
  file for the take list; the download is a normal anchor.
- Disk: a `FileSystemFileHandle` is chosen *before* recording (a separate click, because two
  gesture-gated prompts cannot be chained). Chunks are written through a queued
  `FileSystemWritableFileStream`. The file is read back only to produce a preview/poster.

---

## Project layout

```
src/
  components/
    Studio.svelte        the recorder UI (Svelte 5 runes)
    Toggle.svelte        accessible switch
    Icon.svelte          inline icon set
  layouts/Base.astro     document head, fonts, metadata
  lib/recorder/
    engine.ts            capture → countdown → record → finalize state machine
    audio.ts             Web Audio mixer + level metering
    formats.ts           MP4/WebM probing and selection
    sink.ts              memory sink + File System Access streaming sink
    media.ts             poster-frame extraction
    presets.ts           sizes, bitrates, formatting helpers
    support.ts           feature detection
    types.ts             shared types
  pages/index.astro      the landing page and static copy
  styles/global.css      design tokens and resets
```

The recorder engine is framework-agnostic; the Svelte component only mirrors its snapshot.

## Local development

```bash
npm install
npm run dev       # Astro dev server, base path /tape
npm test          # unit tests for the pure helpers
npm run check     # Astro + TypeScript diagnostics
npm run build     # static build into dist/
npm run preview   # serve the built site
```

Open the dev URL with the base path, e.g. `http://localhost:4321/tape/`.

If the site moves to a different path, pass `BASE_PATH`:

```bash
BASE_PATH=/recorder npm run build
```

## Deploying to GitHub Pages

The workflow is `.github/workflows/deploy.yml`.

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` (or run the workflow manually).

The workflow:

- installs with `npm ci`, runs `npm test`, then `npm run build`;
- derives the base path from the repository name (`BASE_PATH="/${GITHUB_REPOSITORY#*/}"`);
- uploads `dist` with `actions/upload-pages-artifact` and deploys with `actions/deploy-pages`.

For a user/organisation Pages site with a custom domain, the site is served at
`https://shubhamtatvamasi.com/tape/`; no `CNAME` file is needed in this repository. The repository
is named `tape`, and the path follows the repo name automatically.

## Browser support

| Browser | Capture | Formats | Write to disk |
| --- | --- | --- | --- |
| Chrome / Edge | screen, window, tab | MP4 (platform encoder) or WebM | Yes (`showSaveFilePicker`) |
| Firefox | screen, window | WebM | No; falls back to memory |
| Safari 18.4+ | screen, window, tab | MP4 or WebM | No; falls back to memory |
| iOS / Android | most mobile browsers do not expose `getDisplayMedia`; the app detects this and shows a clear unsupported state instead of a broken recorder | — | — |

- Screen capture needs a secure context (HTTPS or localhost).
- System audio is Chromium territory; Firefox and Safari give microphone audio only.
- On mobile, Chrome/Firefox do not expose screen capture. If a browser does expose it (some recent
  Safari versions on iOS do), the full recorder, preview and share sheet are available. Otherwise
  the page explains the limitation and points at a desktop browser.
- In-memory takes are comfortable to roughly 20 minutes at 1080p. Use disk streaming for longer.
- Wake lock keeps the display awake during a take where the browser supports it, but it cannot stop
  the OS from sleeping if the user closes the lid.

## Privacy

There is no backend. Capture, audio mixing, encoding and saving happen in the page. No analytics,
no fonts or scripts from third parties, no cookies, no uploads. Takes live in the tab (or in the
file you picked) and are gone when the tab closes.
