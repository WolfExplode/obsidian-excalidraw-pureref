---
status: accepted
---

# Keep Board previews ready and prepare JPEG detail off the renderer thread

## Context

The target workflow is zoom into an image, zoom out, pan to another image, and
zoom in again on a large Board. Excalidraw's cached canvases can retain deferred
original-image commands. The October 10 native capture found 21.8 seconds of
main-thread decoding in 60 seconds, mostly JPEG. Decoding occupied about 79% of
the first 1,000 marked slow cached-canvas draws. Keeping those canvases alone
did not resolve the user-observed freezes. See the
[attribution investigation](../investigations/image-lod-attribution-trial.md).

## Decision

Smooth image navigation is enabled by default on compatible renderer builds.
The host owns one worker per editor, image source identity, queued detail,
resident Board previews and deterministic teardown via `attachPerLeafScanner`.
The user can disable it in Plugin settings or with **Toggle smooth image
navigation**. That preference survives reload through the shared
`PluginDataWriter`; worker pixels and callbacks are never persisted.

The Excalidraw patch exposes `setImageRenderSourceProvider` and
`refreshImageRenderSources`. The provider returns a ready bitmap, null while
pixels are pending, or undefined for native rendering. It runs before image
canvas generation, so pending JPEGs never queue original-image commands.
Ready lower-detail pixels remain visible while sharper detail is prepared.
Coordinate mapping preserves original crop geometry, aspect, flips and rotation.

The public Obsidian Excalidraw release does not expose these hooks. It remains
usable with the host plugin, but follows native rendering. Settings explain the
requirement and diagnostics report `unavailable`; no worker or previews attach
on that build. This is a supported paired local implementation, not a published
Excalidraw dependency or a promise that an unmodified public release is optimized.
ADR 0001 permits the narrow renderer patch because the public file API would
also replace the originals used by saves and exports.

## Memory, work and ownership

- Keep aspect-preserving 128-pixel previews for every loaded JPEG on the Board,
  including off-screen images. Give them a separate 64 MiB pixel allowance.
  Shrink their longest dimension to a power of two if worst-case square previews
  for the complete Board would exceed that allowance. They survive detail
  eviction until source replacement, image removal, Board switch or teardown.
- Detail tiers are 128, 320, 768, 1600, 3200 and 6400 pixels, capped at original
  size, with a separate 96 MiB pixel allowance. Account for viewport zoom,
  device pixel ratio and crop magnification. Prefer the smallest adequate tier.
- Serialize decoding per view. Prioritize visible previews, visible detail,
  then off-screen preview preparation. Cull off-screen detail and replace queued
  detail when its requested tier changes. Retain reusable detail within an LRU;
  suppress repeated eviction/regeneration while the viewport remains stable.
- Decode existing JPEG data URIs inside the owning window's worker and transfer
  prepared bitmaps. JPEG byte-prefix checking rejects mistagged formats.
  No network request, vault write, IndexedDB cache or global canvas interception
  is introduced. Original-file startup loading remains native.
- The renderer retains image canvases across upward sqrt(2) zoom bands within
  128 MiB and 4,096 entries per editor. Changes to image identity, version,
  dimensions, crop, theme, frame opacity or prepared pixels invalidate tiers.
- Generation and source guards reject stale completions. Clear renderer
  references before closing bitmaps; source changes discovered during rendering
  schedule that invalidation at a microtask boundary, without a settle timer.
  Clear the provider before worker disposal. Decode failures use a ready preview
  or the native fallback, rather than a permanent loading rectangle.

These budgets count retained pixels, not total Obsidian RAM, encoded originals,
temporary worker decoding, native element canvases or browser/GPU allocations.
PNG, SVG, animated formats, requests above 6400 pixels, native crop-editor
uncropped previews and read-only Popout exports use native rendering. Original
files, element data, history and saved Boards are unchanged. Every export bypasses
the display provider and uses full-resolution originals.

## Preservation and validation

The single [renderer patch](../patches/excalidraw-0.18.140-image-navigation.patch)
and [build handoff](../patches/README.md) preserve the source outside gitignored
`reference/`. Earlier ADRs 0015 and 0016 are historical experiments superseded by
this decision. Their obsolete host cache and renderer-map API have been removed.
No dependency version is bumped or published for this checkpoint.

Host `npm run verify` includes typecheck, current bundle verification and tests.
Focused renderer tests cover pending pixels, same-zoom replacement, band reuse,
source invalidation and original-resolution export. Cache tests cover off-screen
preview retention, budgets, priority, stale completions/disposal and native failure
fallback. Preference tests cover reload, preservation of other plugin records
and failed writes. The fork build and declarations pass; full monorepo typecheck
retains the same 365 baseline errors after normalizing shifted line numbers.

The persistent-preview natural capture retained all 484 JPEG previews at
23,382,528 bytes throughout navigation, without decode errors. Attached canvas
draws totaled 2.7 seconds across 100,814 calls. Native main-thread image decoding
totaled 0.46 seconds, compared with 21.8 seconds in the original capture. Gestures
differ, so these are indicative rather than a controlled benchmark. The user
reported substantially smoother navigation, no blank rectangles, and acceptable
remaining pauses. A 274.5 ms main-thread task remains unattributed; eliminating
all stutters is not claimed.

Before broader distribution, manually check cold startup and original loading,
crop/flip/rotation, image replacement, PNG export, Board switching, worker failure,
closing during decode and editable Popout teardown. Mixed-DPI Popouts require
separate validation. The most likely regression is insufficient sharp detail
under memory pressure; unsupported formats can still incur native decode pauses.
Additional optimization, disk caching and concurrency are future work.
