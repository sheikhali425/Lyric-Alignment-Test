# Decisions

I built this with AI coding agents (Claude Code) writing most of the code: a planning agent (Claude Opus) wrote the integration code, and Sonnet subagents built modules in parallel, each owning its own files. The agents kept this log while it worked; I later edited it for readability and marked who made each call:

- **(mine)**: I made the decision; the agent implemented it.
- **(agent)**: the agent decided while implementing, usually where the brief was silent; I reviewed it and kept it.

Entries about bugs found during QA say who found the problem and who chose the fix. Some early entries say "not yet run in a browser"; they were true when written and are marked as superseded where later work covered them. `NOTES.md` has the short summary.

## Architecture and core decisions

- **(mine) The API stays unchanged.** `PUT` takes a full snapshot, which already covers paste, add, merge and split, and the 409 response carries the server's state. Nothing about the editor needed a different shape, so changing the schema would have been churn with nothing to show for it.

- **(agent) All times inside the app are integer milliseconds.** Seconds appear in only two places: the server adapter (`duration_seconds`) and `domain/time.ts` (`audio.currentTime`). The README asks for "one units boundary"; this is where it lives.

- **(agent) Everything is keyed by line id, never by text.** The seed repeats lines word for word, so any lookup by text would give the wrong line.

- **(mine) No waveform library; the waveform is drawn on canvas.** `wavesurfer.js` would draw the waveform for free, but the segment lane, multi-drag, trim and snapping would then have to work around its region model. Owning the canvas also lets us measure frame cost directly. Rejected: wavesurfer.js, peaks.js.

- **(mine) No state library.** One reducer-style store with snapshot undo history, plus a separate external store that publishes the playback position at rAF rate. That way the 60 Hz playhead never re-renders the lyrics list. Rejected: Zustand/Redux. They would add a dependency without solving anything this split doesn't already solve.

- **(mine) Stamping is the main workflow.** Space plays and pauses. Enter stamps the start of the cursor line, closes the previous line's end, and moves the cursor down. A single listen through the song then times the whole sheet. Dragging is for fixing mistakes, not for first placement.

- **(agent) Server track: explicit save. Brought track: local only** (doc in localStorage, audio Blob in IndexedDB). The API has no route to create a track, and faking one server-side was out of scope.

## Editing model and state

- **(agent) Stamp end semantics.** `stamp` sets the start of a line and closes the previous line only if that line's end is *after* the stamp (overlap/provisional end). A previous end that is already before the stamp is left alone, so gaps stay as instrumental breaks. A `Segment` always has an end (the server requires one), so "open" means a provisional end. The stamped line keeps its old end if still valid, otherwise gets next line's start if timed, otherwise `min(at + median segment length, duration)` with 3000 ms when nothing is timed yet. The next stamp overwrites that provisional end. (Extended later: see "placeholder end" under Integration pass.)

- **(agent) `stampEnd` is a no-op on an untimed line.** An end without a start has no meaning.

- **(agent) Min segment length 100 ms (`MIN_SEGMENT_MS`).** Every op funnels through one `makeSeg` that rounds, clamps to [0, duration] and enforces it, so ops cannot produce something the server would reject. If a stamp lands within 100 ms of the previous start, the previous line ends up with a 100 ms segment that may overlap the new one slightly, rather than an invalid one.

- **(agent) Group shift clamps the delta, not each member.** The delta is limited to `[-minStart, duration - maxEnd]`, so spacing is preserved. Clamping per member would squash lines against the edge. `trimEdge` works per line, since edges are independent.

- **(agent) Snapshot history, not command history.** Docs are immutable and share structure, so keeping up to 200 whole docs is cheap, and undo/redo cannot drift out of sync with the ops. Cost: no per-op labels.

- **(agent) Coalescing: 600 ms sliding window per key.** Each apply with the same key within 600 ms of the previous one extends the window and does not add a history entry, so a burst of arrow-key nudges is one undo step. Any non-keyed apply, undo or redo breaks the chain. `apply` during a transaction is treated as `applyLive`. Undo/redo are ignored mid-drag.

- **(agent) `replaceSheet` keeps ids/timings of unchanged lines via an LCS diff on text.** This is the one place text is used for matching. It only decides which existing line object survives, so ids stay the key everywhere. Re-pasting an edited sheet does not wipe timing. Edited lines become new untimed lines.

- **(agent) `dirty` uses a canonical fingerprint** (`docKey`: lines in order plus their segments), not `JSON.stringify(doc)`, so segment key order cannot cause false dirty.

- **(agent) `split`/`addLine` take an optional explicit new id** (the callers need to know it to move the cursor/selection); ops stay otherwise `Doc -> Doc`. `split` is a no-op if either half is empty, and a segment shorter than 200 ms stays on the left half only.

- **(agent) `playback.seek` cancels a `playRange` auto-pause.** Clicking the timeline during selection preview should keep playing, not stop at the old end.

- **(agent) Playback ms is published only when it changes, and a shared `useExternalSelector` (state/external.ts) memoises selectors** so shallow-equal object selectors don't loop or re-render.

- **(agent) Test runner: Playwright with a no-browser config (`e2e/unit.config.ts`, `pnpm test:unit`).** Playwright's TS loader imported the extensionless sources fine, so no `node --test`/.mjs fallback was needed. The default config's webServer would try to start/reuse the API and web servers, so unit tests have their own config.

- **(agent) Not tested at the time:** `playback.ts` and `serverAdapter.ts` (need a browser audio element / live API); they were only typechecked. (Superseded: both are now exercised by the browser specs.)

### Integration and test setup

- **(agent) The dev-server port can be overridden with `WEB_PORT`. The default is still 5173.** On the build machine, 5173 and 5174 were both taken by unrelated projects that had to keep running. On top of that, Playwright's `reuseExistingServer` quietly ran the test against one of those other apps, which showed up as a heading that never appeared. Both `vite.config.ts` and `playwright.config.ts` read the same variable. Reviewers who don't set it get exactly the README's setup.

- **(agent) Unit specs are named `*.unit.spec.ts` and run under `e2e/unit.config.ts`.** The main config ignores them, so `pnpm test` stays the browser suite and `pnpm test:unit` takes about 0.5 s with no servers. The original test split used `testIgnore: track.spec.ts`, which would also have swept up every UI spec added later.

- **(agent) Zoom and open-modal state go in a separate `state/view.ts`.** They aren't document state, so they shouldn't land in the undo history. The timeline, top bar and shortcut layer all need to read them.

## Timeline and waveform

- **(agent) Waveform and ruler are canvases the size of the viewport, not the song.** Each canvas is `position: sticky; left: 0` inside a content div that has the full scroll width. On every scroll, zoom or resize (coalesced in one rAF) only the visible window is redrawn, reading min/max columns from `peaksForRange`. Rejected: one song-wide canvas (breaks past the browser canvas size limit at 800 px/s) and tiled canvases (more code, no visible gain).

- **(agent) Peaks are decoded with an `OfflineAudioContext` at 22.05 kHz.** It needs no user gesture and needs no `close()`. 200 buckets/s only needs about 100 samples per bucket, so the lower rate halves memory against 44.1 kHz. Risk: the resampler can shave very short transients slightly. The result is cached per URL as a promise, and failed decodes are evicted. Timing goes through `performance.measure('peaks')` with `detail` (url, buckets, bytes). (When written there were no real numbers; the decode timings measured later are in `NOTES.md`.)

- **(agent) If decoding fails, the timeline still works.** It draws a flat line and a small "Waveform unavailable" notice. The content width falls back to `max(project.durationMs, decoded duration, furthest segment end, 1s)`, so a wrong or missing duration never hides a segment.

- **(agent) The playhead is a DOM element moved with `transform` from `subscribeFrame`.** The Timeline does not subscribe to `usePlayback`, so nothing in it re-renders per frame (by reasoning: its only subscriptions are the doc, selection, cursor, zoom and peaks status). This was not measured with the React Profiler. Auto-scroll is page-flip style: when the playhead leaves the view, scroll so it sits at 10% from the left. Auto-scroll is suspended for 2 s after wheel or pointer input, or after any scroll the code did not cause itself (detected by comparing `scrollLeft` with the value we set).

- **(mine) Zoom anchor.** Ctrl/Cmd+wheel anchors under the mouse: it stores `{ms, off}` and sets the zoom through `view.zoomBy`; a layout effect then fixes `scrollLeft`. Zoom from buttons or keys is covered under Final browser QA.

- **(agent) Drags always compute from the doc as it was at drag start**, not the current doc. `applyLive(() => ops.shift(startDoc, ids, delta))`. That means snapping and clamping never accumulate errors and Escape/cancel is exact. Trim edits only the dragged block, even when several are selected. This was a guess; the brief said "that edge of that block".

- **(agent) Snapping.** Moving edges are tested against the edges of segments not being dragged, plus the playhead, within 8 px. The first match with the smallest distance wins. Alt disables snapping. The guide line is drawn at the target time, even if `ops` then clamps the result (rare).

- **(agent) Escape during a drag** uses a capture-phase `window` keydown listener that exists only while dragging, and it calls `stopImmediatePropagation`, so the global Escape shortcut (clear selection) does not also fire.

- **(agent) Overlap.** Greedy row packing by start time (`layoutRows` in `geometry.ts`). Rows can change live while dragging.

- **(agent) Click semantics on blocks.** A click without movement selects (shift = `selectRange`, ctrl/cmd = `toggle`) and then `playRange`. If the toggle deselects the block, it does not play. Keyboard: Enter or Space on a focused block does the same as a click.

- **(agent) Drop from the lyrics list.** Reads `application/x-lyric-line`. It keeps the existing duration, else uses `DEFAULT_SEGMENT_MS` capped at the track length. The start is clamped so the segment ends inside the track.

- **(agent) Known limits.** The ruler is a canvas, so it is not accessible text. The marquee only selects on the lane, not across the waveform. Touch drag was not tested. Colours are read from CSS variables at draw time, and a redraw is triggered only on the `prefers-color-scheme` media change, not on a manual `data-theme` toggle. (When first written none of this had run in a browser; it was later covered by the drag spec and the QA passes below.)

## Loading, persistence, and saving

- **(agent) Server-track drafts store their own base.** Unsaved work on the server track is autosaved (500 ms debounce, plus on tab hide/unload) to a localStorage draft holding `{baseVersion, baseDoc, doc, title, artist, audioUrl, durationMs}`. On open: same version as the server returns -> restore draft on top (opens dirty, toast). Server has moved on -> still restore the draft but keep its OLD `baseVersion`, so the next save takes the normal 409 path and the user compares, instead of one side being silently dropped. Server unreachable + draft exists -> open from the draft's own metadata so work is never stranded. No draft is written while clean.

- **(agent) Local projects autosave to their real storage; there is nothing to "save".** Cmd+S (`saveCurrent`) just flushes the debounce. After each write we `markSaved`, so `dirty` means "differs from persisted" for both kinds. Local project metadata and doc live in localStorage (`lyric-align:` prefix), audio Blobs in IndexedDB; URL-sourced audio stores only the URL. A project is created blob-first so a quota failure leaves no orphan metadata.

- **(agent) Duration is probed from the audio** with a detached `Audio` (15 s timeout, rejects on decode error or non-finite/zero duration). The probe uses a temporary object URL; the project's playable object URL is created on open and revoked when another project opens.

- **(agent) Conflict flow needs no extra request** (409 body carries server state). "Keep mine" marks the server doc/version as the new base and resaves; "Use server's" goes through `replaceProject(..., {history:'push'})` so it is undoable; Cancel leaves the project dirty (next save conflicts again, by design). Diff is by line id, never text. Rejected for now: line-by-line merge.

- **(agent) Client validation runs before the PUT** (`validateForServer`), shown as a toast, so the server's 400 is only a backstop.

- **(agent) Dialogs stop keydown propagation** so the global shortcut handler (space, arrows, etc.) doesn't fire while typing lyrics in the dialog.

- **(agent) Window drop** hands the file to the dialog through a one-shot module variable (`takePendingAudio`), because the dialog is mounted only while open.

- **(agent) Known limit:** large audio blobs rely on IndexedDB quota (error message surfaced).

## Lyrics, inspector, and keyboard

- **(mine) Tap offset defaults to 0 and is a persisted setting.** Reaction lag differs per person and device, and a guessed default would silently shift every stamp. The LyricsPane header has a "Tap offset (ms)" input (0-500, saved in localStorage) that is subtracted from both Enter and K stamps. A user who taps about 150 ms late sets it once.

- **(mine) The stamp cursor advances to the next line by order and does not skip timed lines.** A re-stamp pass over a rough sheet should visit every line. Past the last line the cursor becomes null. With a null cursor Enter starts at the first untimed line, and does nothing if every line is timed, so a stray Enter at the end cannot restamp the last line.

- **(agent) Undo puts the stamp cursor back.** The cursor is not part of history, so undoing a stamp would leave the cursor one line ahead and the next Enter would stamp the wrong line. `commands.undo()` keeps a small log of (doc after the stamp, cursor before it). If the current doc is that stamp's result, it restores the cursor after undoing. Keyboard undo goes through this wrapper. (Extended after my QA pass; see below.)

- **(agent) K stamps the end of the line before the cursor** (or the last line when the cursor is null). The `stamp` op already closes the previous line when the next stamp lands, so K is only needed for instrumental gaps.

- **(agent) Clicking a timed line plays it. Clicking an untimed line makes it the stamp cursor.** Auditioning is what you want on a timed line. On an untimed line there is nothing to play, so the click is the natural way to say "stamp this one next". Shift-click and Cmd-click only change the selection. Clear timing also moves the cursor to the first cleared line so it can be re-stamped straight away.

- **(agent) Inline edit is F2 or double-click.** Enter is the global stamp key, so while the edit input is focused Enter commits and Esc cancels. Empty text is rejected, which reverts to the old text. A new line from "+ Add line" starts as "New line" and opens straight in the editor.

- **(mine) Drag zones are 25% / 50% / 25% of the row height: before / merge / after.** The merge zone gets a distinct red dashed highlight and a "merge" tag. The earlier of the two lines (by order) keeps its id and comes first in the merged text, whichever one was dragged, so the result reads in lyric order. Only the dragged row moves; a multi-selection is not dragged as a group. Alt+↑/↓ moves the whole selection.

- **(agent) Split lets the user pick the text position.** The Inspector shows the words with a clickable "|" gap between each, and each gap calls `splitAtPlayhead({id, textPos})`. The plain "Split at playhead" button and the S key use the word gap nearest the middle of the text. If the playhead is outside the segment, `ops.split` falls back to the segment midpoint.

- **(agent) Key map choices.** ←/→ nudge the selection ±10 ms (Shift ±100 ms), or seek ±1 s / ±5 s when nothing is selected. Alt+←/→ moves the start edge and `[` / `]` move the end edge, using the physical bracket keys so Shift does not change them. Nudges use `coalesceKey` `nudge:<edge>`, so a burst is one undo step. Cmd/Ctrl+S works even inside a text field. Everything else is ignored while typing and while a modal is open (Esc closes the modal). The key list lives in `ShortcutsHelp/shortcuts.ts` and the help dialog renders it, so they cannot drift apart.

- **(agent) Space is also swallowed on keyup,** so a focused button is not clicked by the space that toggles playback.

- **(agent) Row re-rendering.** `LyricRow` is memoised. Each row receives only its own booleans, and only the row under a drag gets drop props. The active (playing) row is found by selecting the index from `lineAt`, so the 60 Hz playhead re-renders only when the active line changes. Karaoke does the same by selecting `{idx, live}`.

- **(agent) Warnings are editorial hints only.** A row gets ⚠ if its start is earlier than the previous timed line's start, or if it overlaps another segment (found by a sweep over lines sorted by start). They are not blocking and not part of the server validation.

- **(agent) Replace sheet** prefills the paste box with the current text, so editing it keeps timing through the LCS diff in `replaceSheet`. It asks for confirmation only if a timed line would be dropped.

- **(agent) Deliberate gaps:** non-consecutive multi-selection merge is a no-op. Drag handles only the single dragged row.

### Integration pass

- **(agent) The waveform decode promise can no longer be aborted.** In the browser the waveform always said "unavailable", even though `decodeAudioData` worked fine when tried directly (408 ms in headless Chromium). The cause was StrictMode's mount, unmount, mount cycle. The first mount aborted its fetch, the second mount was handed that same cached and already-aborted promise, and it rejected. The decode is shared and cached per URL, so no single component may cancel it. Components now just ignore results they no longer want.

- **(mine) A track opens zoomed to fit the whole song.** At the original fixed 60 px/s, only about 12 s of the 2:05 song was visible, and blocks off-screen looked like missing work. The fit is computed from the track's own duration, and `MIN_PX_PER_SEC` dropped to 1 so long tracks fit as well.

- **(agent) Stamping now extends a placeholder end to meet the next stamp.** The agent's smoke run on a second track showed a 0.5 s gap after every line. The initial stamping rule only shortened the previous end, never extended it, so the 3 s placeholder end survived. Its doc comment claimed otherwise. This mattered because the brief is about speed, and a gap after every line means a fix after every line. `commands.ts` now keeps a session-only set of lines whose end is still the placeholder. A K press removes the line from that set, so a deliberate gap before an instrumental break survives. Rejected: a `provisional` flag on `Segment`, because it would leak into the persisted and server shapes for a purely transient concern.

- **(agent) Accepted:** an end set by dragging or in the inspector does not remove the line from the provisional set. That only matters if you stamp the previous line, edit its end by hand, and then stamp the next line in the same pass. That seemed rare enough to leave.

- **(agent) The app layout has three columns**, with the karaoke readout filling the space the timeline leaves. Below 1000 px wide the columns stack. The wireframe's arrangement was kept because it already matched the workflow: the list drives stamping, the timeline is for fixing, and the inspector handles precision.

## Automated tests

- **(mine) Four browser specs, one interaction each, plus `e2e/helpers.ts`.** Bring-your-own-track (create from a generated WAV, comment and blank lines skipped, a duplicated lyric to prove id-keying, stamp, abutting ends read through the Inspector, reload persistence, no leak of the seeded 28 lines). Bulk shift (range select, 3x Shift+Right, one undo, redo). Save conflict ("Keep mine" and "Use server's", the latter undoable). Timeline drag (Alt held, distance in px converted to ms with px/sec derived from two blocks 4 s apart, not from a hard-coded zoom; undo).

- **(mine) Why these:** they are the places where the code does something non-obvious (id keying, undo coalescing, the 409 flow, pointer maths). Each asserts on visible state (row names, Inspector fields, the API's own GET), not on implementation details.

- **(agent) Shared DB handling.** The server track is never reset, so no test assumes version 0 or an untimed sheet. `restampLine` selects a row, clears its timing if present, then stamps it, so it works on a sheet an earlier run saved. The conflict test picks stamp times that differ from what the server already holds. The two conflict tests run serially, and an `afterAll` saves an empty alignment so the track goes back to untimed. All other specs never press Save.

- **(agent) Direct API calls** use the token from `apps/api/src/config.js`, loaded with a native `import()` (the e2e loader is CJS and cannot load that ESM file directly).

- **(agent) Flakiness handling.** Audio is paused and seeked, with a 150 ms settle, before each Enter, so a playing element cannot drift the stamp. Focus is blurred before key presses. Waits are on state (accessible names, input values), except a 1 s wait for the 500 ms autosave before reload, and a 100 ms wait after resetting scroll. Drag tolerance is two pixels expressed in ms. After zooming in, the timeline viewport is not at the start, so the test scrolls it back before measuring. Without that, `toBeVisible` passed while the blocks were off-screen. Full suite run 4 times, 6/6 each time.

- **(mine) Deliberately not tested:** waveform rendering, LRC export, split/merge, drag-and-drop from the list, snapping behaviour (Alt is held precisely to avoid it), audio playback timing, anything needing a real mp3 decode.

### Agent's scripted browser walkthrough and follow-up fixes

These came from a 29-step scripted walkthrough the agent ran in headless Chromium, exercising every feature. The script is not part of the repo.

- **(mine) You can't zoom out past fit-to-width.** The walkthrough dragged a block's end by 40 px and the end moved by about 42 s, when the visible scale said it should move by about 7 s. The trim maths was right. The problem was that Ctrl+wheel had zoomed out to 1 px/s, and the lane's `min-width: 100%` still stretched the content across the full width. So the blocks and the visual scale disagreed. Zooming out further than "the whole song is visible" has no use, so the fit scale is now the lower bound. It is kept current with a `ResizeObserver`. After the fix the same drag moved 7189 ms against an expected 7189 ms.

- **(agent) "+ Add line" followed by typing the text is one undo step.** Before this it took two undos to remove a line you had just added: one for the text, one for the line. Pressing Escape out of the edit also left a placeholder "New line" behind. Adding a line now opens a store transaction. Committing the text closes it, and cancelling the edit rolls the line back. Rejected: using the 600 ms coalesce window, because typing a lyric takes longer than that.

### My manual Chrome QA pass and fixes

I ran a hands-on QA pass in Chrome against a structured test plan, covering every section including bring-your-own-track, and reported what I found. Unless marked otherwise, the problem was mine to find and the fix was the agent's to design.

- **(found by me; fix by the agent) The stamp cursor still visits timed lines, but it is now restored on undo and redo of every edit that moves it.** The QA report said Enter could overwrite a timed line, and suggested the cursor should jump back to the first untimed line. That suggestion was not taken, because it contradicts my re-stamp-pass rule above. What the report had actually found were three places where the cursor broke the existing rules. (1) Clear timing moves the cursor, but undoing the clear left it on a line that was timed again. (2) Redoing a stamp did not advance the cursor. (3) A fully timed sheet opened with the cursor on line 1, so a stray Enter restamped it, although the rule says Enter does nothing when every line is timed. The stamp-only undo log is now a log of cursor steps (`docAfter`, `cursorBefore`, `cursorAfter`) used by stamp and clear, with a matching redo stack. No-op edits are not logged, because undo would then restore the cursor for the wrong step. `loadProject` uses a null cursor when nothing is untimed. The toolbar's ↶/↷ buttons were calling `store.undo()` directly and bypassing all of this; they now call the same commands as the keyboard.

- **(mine) Zoom from buttons or keys anchors on the playhead when it is on screen, otherwise on the viewport centre.** The original centre-anchor behaviour meant that zooming in from fit-to-width with the playhead at 0:03 threw the view to about 0:30-1:30, and you had to scroll back by hand every time. Wheel zoom still anchors under the mouse. The selection was considered as a second anchor and left out: the playhead is where you are listening, and a selection off-screen would cause the same jump.

- **(found by me; fix by the agent) Enter is ignored in the last `MIN_SEGMENT_MS` of the track, with a toast.** The stamp op clamps its time to `duration - MIN_SEGMENT_MS`, so every Enter after the audio ended stacked another line on that same point, with overlap warnings. The command refuses the stamp rather than changing the op, so the op's clamping stays a safety net for valid stamps near the end, and its existing unit test still holds. The cursor does not advance, so seeking back and pressing Enter stamps the same line.

- **(found by me; fix by the agent) The time readout is capped at the track's stated duration.** The decoded mp3 plays about 50 ms past the `duration_seconds` the API reports, which gave "2:05.009 / 2:04". Only the display is clamped. Playback and stamping still read the real position, and the stamp guard above handles the overrun.

- **(found by me; fix by the agent) After the last timed line, Karaoke shows that line dimmed** instead of "Stamp some lines to see them here.", which read as if nothing had been stamped.

- **(found by me; fix by the agent) When a local song opens first, the server track's title is fetched in the background** so the Load song list does not say "Server track". It is fire-and-forget, and a failure leaves the generic label, since the title is cosmetic there.

- **(found by me; fix by the agent) The timeline's scroll container has 12 px of bottom padding** so an overlay scrollbar does not cover the bottom row of blocks. It goes on the container, not the content, because the playhead and snap guide stretch to the content's full height and would otherwise run into the gap. Not verified in headless Chromium, which does not draw overlay scrollbars.

- **(agent) Tests for these fixes.** `e2e/stamp-cursor.unit.spec.ts` covers the three cursor cases and the end-of-track guard. It drives `commands.ts` under the no-browser unit config by attaching a stub audio object to `playback`, with a duration slightly longer than the project's, like the real track. The zoom anchor was checked with a throwaway headless script (playhead at 0:03, + three times, playhead stayed at the same x), not a committed spec.

## Left open

These product choices were left as they are: clicking a timed line plays it (recorded above), both halves stay selected after a split, the conflict dialog cannot merge edits made to different lines, and nothing in the UI explains the local-versus-server save difference.
