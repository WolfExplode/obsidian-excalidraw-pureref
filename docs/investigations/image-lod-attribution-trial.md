# Image LOD attribution trial — October 10, 2026

The user reports that navigation still lags and that the effect of the prototype
is unclear. LOD is disabled after this trial. It should not be enabled by default
or described as a successful performance fix.

## Evidence and limits

The CPU/native timeline auto-stopped after 180.2 seconds; the temporary renderer
hooks continued until the user's completion message (327.7 seconds). Those
windows differ and their totals must not be combined. Hook arrays retain at most
3,000 entries; the generation ring filled, so 3,000 is a lower bound. Publication
hooks were attached only to the API instances present at setup; new views do not
inherit them. All temporary wrappers and observers are now removed.

CPU sampling attributed 29.795 seconds to native `drawImage`, 17.395 seconds to
host plugin call stacks, and 9.806 seconds to Extended File Support call stacks.
These are one trial's sampled costs, not a controlled comparison with previous
routes. The timeline includes 420 main-renderer `Decode Image` events totaling
4.676 seconds (maximum 87.583 ms) and 761 background-thread decode events totaling
3.230 seconds. Nested decode events describe overlapping work and must not be
added together. The longest recorded main-renderer task was 2.670 seconds.

The generation hooks retained 3,000 bitmap creations, mostly 128- and 320-pixel
tiers, with a p95 asynchronous completion time of 49.1 ms. Their 65.23 seconds
of elapsed completion time includes waiting on other tasks and is not CPU time.
There were 1,394 observed source publications whose synchronous setters totaled
132.5 ms; deferred redraw cost is not included. Recorded published proxy bytes
peaked at 100,652,360, below the 96 MiB per-view budget. The final cache had 456
proxies, 94,987,152 pixel bytes, six requests queued, and no failed sources.

This demonstrates excessive generation/replacement during changing zoom,
not proof that memory budgeting failed. The prototype stores one tier per file,
replaces it whenever the requested tier changes, and releases visible proxies
when zoom requires originals. Repeated zoom can consequently regenerate work.
The next LOD design needs reusable tiers and measured generation/redraw policy
before another trial; adding an arbitrary settle timer is not a remedy.

## Independent hot path addressed

CPU samples also identified `planFrontOfEmbedCandidates` overlap testing and
`elementAABB` as expensive host-plugin work. Each candidate/embed pair formerly
recomputed both bounds, including trigonometry and point scans. The planner now
calculates each embed's bounds once and each candidate's bounds once per scan,
while preserving z-order, overlap epsilon, rotation, labels, and eligibility.
The bounds are local to the scan so later geometry changes remain visible.

On a captured 609-element Board geometry snapshot containing 48 embeddables,
the before/after planner returned identical candidates. A seven-run median
microbenchmark (1,000 scans per run after warmup) measured 0.4365 ms versus
0.0494 ms per scan. This is about 8.8 times faster for the planner only, not an
end-to-end UI speedup. A regression test checks that bounds are calculated once
per scan and refresh after movement. Host verification passes (238 passed,
one existing skip). The new host bundle is reloaded with LOD disabled.

Raw profiles, trace, hook data, geometry snapshot, and microbenchmark are local
under `C:/Users/WXP/.codex/tmp/board-profile/`, using the
`2026-10-10-lod-attribution` and `front-embed` prefixes. Source-image bytes are
absent from the hook and geometry captures.

## User observation with the host plugin disabled

The user reports first-visibility stutter at a fixed zoom, followed by smooth
panning once all images have been visited. Changing zoom repeats the cycle.
This occurs with the host plugin disabled and supplies a useful isolation check.

The matching Excalidraw 0.18.140 renderer has a single `elementWithCanvasCache`
entry per element. `generateElementWithCanvas` regenerates when the cached
`zoomValue` differs from the current exact zoom and `shouldCacheIgnoreZoom` is
false. `generateElementCanvas` creates and sizes a canvas for that zoom and
draws the source image into it. The static renderer paints visible elements,
so off-screen elements take this path when first brought into view. During
zoom gestures the renderer may temporarily reuse the old canvas; its existing
300 ms debounce eventually resets `shouldCacheIgnoreZoom`, allowing regeneration.
This describes upstream behavior, not a proposed new timer.

The observation therefore closely matches lazy render-cache warming after
zoom invalidation. It does not by itself attribute the rebuild cost between
source decoding, resampling, canvas allocation, and GPU work, and does not
establish slow vault/disk-cache access. The source-proxy prototype left this
exact-zoom render-cache regeneration intact and added source replacement work.
The next image optimization should address image render-cache reuse across
zoom ranges or retained resolution tiers, with bounded memory, crop/theme/source
invalidation, and original-resolution exports, before revisiting source proxies.

The next local checkpoint implements that renderer reuse directly; see
[ADR 0016](../adr/0016-experimental-image-render-cache.md). It is installed and
its runtime counters are available, with source proxies disabled. Eleven focused
tests pass, including renderer and export branches. Natural navigation has not
yet established a stutter improvement; first visits to new tiers still render.

## Render-cache trial readback

The first natural navigation trial recorded a delta of 169,813 hits, 4,724
generations and 4,196 LRU evictions on WIP/Untitled.md. Readback found 512 retained
entries and 22,409,612 pixel bytes, about 21.4 MiB. Thus the entry-count guard,
not the 128 MiB pixel budget, limited this large Board. The original 512-entry
choice was too small even for its roughly 561 images at one band. It has been
raised to 4,096, with the pixel budget unchanged. These counters cover the
baseline-to-readback interval, not a timed route or frame benchmark; generations
include all normal rendering invalidations and do not individually identify causes.

The expensive cold path still creates a canvas and draws its original image.
Prior native traces measured decode stalls and CPU samples attributed substantial
time to drawImage, but do not fully separate decode, resizing, allocation and GPU
work. Slow disk-cache retrieval is unproven. Retaining more tiers avoids repeated
work; accelerating first-tier creation needs another targeted timing attribution.

The corrected 2.28.1 production bundle is 4,989,693 bytes and is installed. The
consumer's original checkout was found on master at 7f164485 during this pass,
so the integration build used a separate local clone,
`reference/obsidian-excalidraw-plugin-render-cache-test`, detached at the exact
2.28.1 tag (128a9ef4), sharing the ignored dependency directory. Its manifest
was verified as 2.28.1 before installation. The original source checkout was
preserved. The previous live render-cache bundle was backed up under
`C:/Users/WXP/.codex/tmp/board-profile/excalidraw-before-cache-cap-correction-20261010/`.
Build and 12 focused tests pass; full typecheck remains at the same 365 baseline
diagnostics. A fresh natural trial is required to measure the corrected limit.

The corrected-limit trial returned 149,343 hits, 3,485 generations and 2,558
evictions between baseline and readback. It retained 728 entries using
132,123,488 pixel bytes (about 126 MiB), so the byte budget now limits retention.
The user reports similar stutter. Routes and intervals were not controlled;
the lower generation/eviction totals are not proof of a speedup. Increasing
entry capacity alone did not establish a perceptible improvement.

A temporary main-renderer drawImage probe is installed for the next natural
trial, bounded to 90 seconds with automatic restoration. It aggregates source
types and attached/detached destination canvases, retaining at most 100 calls
over 8 ms and 200 long tasks; a small sample includes stacks for attribution.
Dimensions are captured, not image bytes or URLs. Synchronous call timing
cannot measure deferred GPU execution or separate nested decode/resampling
costs. The probe must be read after normal user navigation, not scripted input.

That first timing probe expired with zero draw calls and unchanged counters;
later readback showed navigation had occurred after it stopped. This capture
contains no performance evidence. Re-armed the probe to begin on the first
trusted pointerdown or wheel within the main-window Excalidraw surface, then
run for 90 seconds. Waiting in chat no longer consumes the capture window.

## Gesture-triggered draw-cost capture

The successful recording lasted 91.97 seconds. Canvas-to-attached-canvas draws
recorded 264,115 calls, 23,700.8 ms of synchronous elapsed time, a 75 ms maximum,
and 1,148 calls taking at least 8 ms. Image-to-detached-canvas draws recorded
3,507 calls totaling 19.8 ms, with a 0.4 ms maximum. Three ImageBitmap draws
took 0.1 ms total. Seventy-six long tasks totaled 25,391 ms, maximum 4,556 ms;
these totals overlap draw timing and must not be added. Only the first 100
slow-call details and 20 stacks were retained. All probe hooks are removed.

The recorded stack's `ky` function was verified by inflating the actually
installed consumer runtime: it is `drawElementFromCanvas`, which draws the
cached element canvas onto the Board. Its callers map to `drawElement` and
`renderElement` in the ordinary static rendering loop. This is not the source
proxy setter or host overlap planner. Sample destinations are the Board-sized
2127 by 1291 canvas. Browser feature status reports accelerated 2D canvas,
GPU compositing, and rasterization enabled; disable-gpu switches are absent.

The visible cached-canvas draw is where synchronous cost is charged. It does
not prove original decoding is negligible: canvas commands may defer decode,
rasterization or resource work until this downstream draw. GPU upload/flush,
deferred source rasterization, and sampling remain alternatives to separate
with native timeline attribution. A worker proxy implementation should not be
chosen solely from the tiny upstream image draw call times. The timing wrapper
adds measurement overhead to every draw; this is attribution, not a clean
before/after frame benchmark. Raw compact results and the inflated installed
runtime are local under `C:/Users/WXP/.codex/tmp/board-profile/`, with the
`2026-10-10-cached-canvas-draw-cost` and `render-cache-installed-runtime` names.

## Next native attribution and implementation boundary

The user authorized continuing and asked whether the host plugin alone can fix
this. The public imperative API provides files and scene operations but does not
expose element cache entries or cached-canvas drawing. addFiles replaces file
data used by save/export. The experimental setImageRenderSources API is already
a fork addition; moving proxy generation into the host does not make its renderer
integration a stock public API. Host-only work can reduce the host's own load and
prepare sources, but a safe change to the measured blit path needs a narrow core
patch or an upstream API. A production global canvas-prototype interception is
not an accepted integration contract merely because profiling uses a wrapper.

A gesture-triggered native capture is armed through the local CDP helper
`C:/Users/WXP/.codex/tmp/board-profile/capture-canvas-raster.cjs`. It records native
GPU/Skia/cache and timeline events plus CPU samples for 60 seconds after the
first trusted main-window Board gesture. Slow draws include destination class
and bounded User Timing intervals for native correlation. Waiting in chat does
not start capture. Output prefix is `2026-10-10-canvas-raster`; the shell session
can be stopped early with `stop`. No synthetic navigation or new renderer fix is
introduced. Interpret deferred source work separately from synchronous API time
before choosing workers or immutable cache bitmaps.

The first native attempt failed to start: Runtime.addBinding's exposed function
requires exactly one string argument; the gesture callback passed none. No
native trace was produced and no conclusion can be drawn from that trial.
Corrected the call to pass `start`, added a separate `ping` acknowledgment, and
verified the full recording/stop/file-save lifecycle without navigating the
Board. That idle transport smoke test is saved with the `canvas-raster-smoke`
prefix and is not reproduction evidence. The corrected helper is re-armed for
real user navigation, with an interactive shell stdin so `stop` works reliably.

## Successful native raster capture

The real gesture-triggered capture lasted 60.01 seconds and saved
`2026-10-10-canvas-raster-{trace,hooks}.json` and `.cpuprofile`. The recorder
stopped automatically, saved its stream, and restored its draw wrapper.

The hook measured 127,327 cached-canvas draws into `excalidraw__canvas static`,
23,127.6 ms of synchronous elapsed time, maximum 77.4 ms, with 1,085 draws over
8 ms. There were 2,907 original IMG draws into detached canvases totaling 27.1
ms, maximum 0.5 ms. Native main-thread Decode Image events, however, numbered
2,007 and totaled 21,787.2 ms, maximum 85.073 ms. JPEG/jpg decoding accounts
for 20,776.8 ms, PNG for 985.1 ms, and WebP for 25.4 ms. These decode costs are
nested in raster/draw work and must not be added to their enclosing totals.

Correlating User Timing intervals with native events found 1,000 main-thread
decodes wholly inside the first 1,000 marked slow canvas draws. They took
13,909.3 ms out of those draws' 17,583.8 ms, about 79%. Only the first 1,000
slow draws were marked, so this is a bounded sample rather than all draw calls.
The saved correlation is `canvas-raster-correlation.json`.

This confirms deferred original-image decoding as a substantial cause in this
trial: the initial cached-canvas drawing call queues work, and decoding is
charged when the cached canvas is rasterized for display. The earlier tiny IMG
call durations did not rule out decoding. It is not merely a hypothesis about
GPU uploads and is not evidence of slow vault/disk retrieval. Native raster
totals overlap these decodes. Trace overhead prevents treating this recording
as a clean navigation benchmark.

The next experiment should prepare resized JPEG pixels off the main renderer
and preserve ready tiers, rather than only retaining canvases containing lazy
original-image drawing commands. It must also prevent pending proxy requests
from immediately falling through to an original draw: otherwise main-thread
decode happens before asynchronous preparation can help. That behavior needs
an explicit renderer readiness contract. The current display seam's original
fallback and the scene-change scanner alone do not guarantee readiness before
the first draw. Use ready lower-resolution pixels or a loading placeholder
until prepared pixels exist, reject stale completions, budget each view, and
preserve original-resolution export separately. This remains an implementation
direction, not a tested fix; animated images and unsupported sources need a
deliberate native fallback.
