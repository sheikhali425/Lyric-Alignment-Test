# Project Notes: Lyric-Timing Editor

I built this with AI coding agents writing most of the code. I made the main product and design calls, reviewed the code, chose what to test, and ran a hands-on QA pass in Chrome. The agents made many implementation decisions along the way; `decisions.md` records each decision and marks whether it was mine or the agent's.

## What I chose

- Make lyric timing fast: play the track and press Enter when each line starts. Dragging is for fixing mistakes, not for first placement.
- The stamp cursor walks every line in order, so a second pass can re-stamp a rough sheet.
- Tap offset (reaction-lag compensation) is a manual setting that defaults to zero, because lag differs per person and device.
- Draw the waveform and segment lane on canvas instead of using wavesurfer.js or peaks.js.
- No state library: one small store with snapshot undo/redo, plus a separate playback store so the playhead doesn't re-render the lyrics list.
- Leave the API unchanged; its snapshot save and 409 response were enough.
- Zoom: open zoomed to fit the whole song, don't allow zooming out past that, and anchor button zoom on the playhead.
- Lyric list drag zones: drop above, merge into, or drop below a line.
- Which interactions get browser tests: bring-your-own-track, bulk shift with undo, save conflict, timeline drag.

## Decided by the agent, kept by me

The main ones (full list and reasoning in `decisions.md`): group shifts that keep spacing, with a burst of nudges as one undo step; seeded track saved to the server while imported tracks stay in the browser (the API can't create tracks); the Keep mine / Use server's conflict dialog; click a timed line to play it, click an untimed line to stamp it next; the keyboard map.

## Second-track check

Besides the seeded song, I loaded a second song of my own (about 1 minute long, with its own lyric sheet) through "Load song" and aligned it in the editor. That took me about 15 minutes. The `bring-your-own-track` browser spec also covers this path automatically with a generated 20-second WAV and a 5-line sheet.

## What I deliberately skipped

- Merging conflicting changes line by line.
- Adding a server API for creating tracks.
- Touch-based timeline dragging.
- Full Firefox and Safari testing.
- Production and low-end-device performance testing.
- Full screen-reader support for the canvas ruler.
- Browser tests for every feature.
- Automatic correction for tap timing delay.

## What surprised me

- React StrictMode exposed an issue where waveform decoding could be cancelled unexpectedly.
- A port conflict caused tests to run against the wrong app; the `WEB_PORT` override fixed this (e.g. `WEB_PORT=5180 pnpm test`).
- Zooming out exposed a timeline scale issue.
- Some stamping behavior needed adjustment when lines had placeholder end times.
- My manual Chrome QA found bugs with undoing the stamp cursor, zoom jumping away from the playhead, pressing Enter at the end of the track, and the MP3 playing slightly past its stated duration.

## Measurements

Setup: headless Chromium on an Apple Silicon Mac running the Vite **dev** build (StrictMode on, unminified). The display refreshes at 120 Hz, so one frame is about 8.3 ms. Each run plays the real audio for 8 s, timing frames with `requestAnimationFrame` and catching long tasks with a `PerformanceObserver`. React re-renders were counted through a stub `__REACT_DEVTOOLS_GLOBAL_HOOK__`, the same hook React DevTools uses. The measurement script was a throwaway and is not in the repo.

| Doc size | Frame p50 | Frame p95 | Frame p99 | Long tasks | Components re-rendered per frame |
| --- | --- | --- | --- | --- | --- |
| 28 lines (real) | 8.3 ms | 9.3 ms | 9.5 ms | none | `TimeReadout` only |
| 280 lines (10×, synthetic) | 8.3 ms | 9.3 ms | 9.4 ms | none on 2 of 3 runs | `TimeReadout` only |

- Over 8 s, `LyricsPane` and `Karaoke` re-render only when the active line changes: 2 times at 28 lines, about 20 times at 280. Each time only the 2 affected rows re-render, because rows are memoised. `Timeline` and `Inspector` never re-render during playback; the playhead moves by writing `transform` directly.
- The first 280-line run, straight after swapping in the big document, had long tasks of 57–165 ms. The two runs after it had none. The likely cause is first-mount warm-up (280 new rows, then GC), but that run also overlapped with the e2e suite on the same machine, and it wasn't profiled further.
- Waveform decode for the 2:05 MP3 (2.8 MB), fetch + `decodeAudioData` + peaks, took 699–931 ms over two runs. A bare `decodeAudioData` took 408 ms. It runs once per track and is cached.
- Not measured: production build, Firefox and Safari, low-end hardware, or anything beyond 280 lines.
