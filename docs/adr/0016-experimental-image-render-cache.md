---
status: superseded
---

Superseded by [ADR 0017](0017-smooth-image-navigation.md). This document records
a historical trial, not current activation or build instructions. Its old patch
is retired; use the [single current renderer patch](../patches/README.md).

# Reuse image render canvases across zoom bands

The user observed first-visibility stutter at each new zoom with the host plugin
disabled. Excalidraw 0.18.140 retains one canvas per element at an exact zoom;
changing zoom replaces it as visible images render. Source proxies did not
remove this invalidation. See the [attribution investigation](../investigations/image-lod-attribution-trial.md).

## Decision

Test a narrow local renderer change under ADR 0001. Image render canvases use
sqrt(2) zoom bands rounded upward, with at most sqrt(2) linear oversampling.
Each editor retains recently used image canvases across bands, using an LRU
with a 128 MiB pixel-byte budget and a 4,096-entry limit. Non-image rendering
keeps its existing zoom behavior. Native visibility culling remains in place.

The budget bounds retained tier entries, not total RAM or GPU allocations.
Excalidraw separately retains each element's current canvas, which can survive
eviction from this tier cache. A first visit to a new band still allocates and
renders; returning to evicted tiers also renders again. This checkpoint does
not move generation to workers or prewarm off-screen images.

Invalidate all retained tiers when upstream removes/replaces the current cache
entry, or when image version, dimensions, crop, theme, containing-frame opacity,
original image object, or display proxy changes. Resampled bands use smoothing.
Clear caches on editor reset and unmount. The cache is owned by each editor's
image-cache map, rather than a global current Board. Original file stores,
serialized elements, history, and export rendering remain authoritative.

The source-proxy command from ADR 0015 remains disabled for this trial. This
renderer optimization works independently of the host plugin and applies to
images accepted by the native image renderer, without JPEG-only filtering.

## Local handoff and verification

The combined patch is [current patch handoff](../patches/README.md).
It includes the earlier, inactive display-source seam. Apply this patch alone
at npm commit `6a4e51cc8e343f484f47d306ac9c09e1db515cb0`; do not apply it on top
of the older image-LOD patch. Reverse-apply checking succeeds against the local
fork. Build `packages/excalidraw` with `build:obsidian`, copy its four Obsidian
artifacts into the 2.28.1 consumer's installed dependency, and build the consumer.
There is no dependency version change or published release.

The fork Obsidian build and generated declarations pass. Twelve focused tests
pass, including real renderer reuse, same-zoom source invalidation, and export
bypass. Helper/test lint and diff whitespace checks pass. Full monorepo typecheck
has the same 365 baseline diagnostics; this change adds none. The production
consumer build passes and produces a 4,989,689-byte `main.js`.

The first navigation trial hit the original 512-entry guard while retaining
only 22,409,612 pixel bytes. Between baseline and readback, it recorded 169,813
hits, 4,724 generations and 4,196 evictions. This demonstrates substantial reuse
and churn, not a frame-time improvement. The guard was raised to 4,096 so a
561-image Board can retain several bands before hitting the count limit;
the pixel-byte budget remains unchanged. A regression test retains 1,200 small
canvases without premature eviction. The revised consumer bundle size is
recorded in the attribution investigation.

The previous live bundle is backed up at
`C:/Users/WXP/.codex/tmp/board-profile/excalidraw-before-render-cache-20261010/`.
Only `main.js` and `styles.css` were replaced; manifest and settings were preserved.
After reload, both open views expose `getImageRenderCacheStats()`. The large Board
has 609 elements and shows retained entries and reuse counters. This confirms
installation, not an end-to-end stutter improvement.

Manual gates: pan at a fixed zoom, visit another band, return to the earlier
band, and compare the same route; check crop, flip, rotation, theme, edited/replaced
images and PNG export. Main-window and Popout behavior and teardown need separate
checks, particularly on mixed-DPI displays. Most likely regression: a stale or
soft image at a band boundary or after editing. First-launch decode and new-band
rendering can still stall and require further attribution if they dominate.
