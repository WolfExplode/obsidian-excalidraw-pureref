---
status: superseded
---

Superseded by [ADR 0017](0017-smooth-image-navigation.md). This document records
a historical trial, not current activation or build instructions. Its old patch
is retired; use the [single current renderer patch](../patches/README.md).

# Use an ephemeral renderer seam to test image LOD

The October 10 Board captures found native image drawing and main-renderer
image decoding to be substantial costs. The post-3D capture recorded 3,030
`Decode Image` events totaling 32.10 seconds, with a longest event of 89.91 ms.
Capture routes and durations differed, so these are attribution evidence, not
a controlled before/after speedup. They do not establish a cache eviction cause.

## Decision

Test a session-only JPEG LOD implementation behind a command. The host plugin
owns generation, tier selection, retained proxies, and teardown through
`attachPerLeafScanner`. A narrow addition to the installed Excalidraw fork's
imperative API, `setImageRenderSources`, supplies display-only `ImageBitmap`s.
The normal renderer already culls off-screen elements. The host additionally
limits proxy generation to conservatively visible images.

The public file API cannot substitute pixels without changing the originals
used by saves and exports. The display seam is the concrete blocker permitting
a narrow fork under ADR 0001. It changes no host adapter protocol or saved data.

- Tiers: 128, 320, 768, and 1600 pixels, chosen from zoom, device pixel ratio,
  and crop magnification; larger requirements fall back to originals.
- One asynchronous bitmap creation per view at a time. No wall-clock settle
  delay determines readiness.
- Retain off-screen proxies until a 96 MiB decoded-pixel budget requires their
  eviction. This is a per-view proxy budget, not a bound on Obsidian's total RAM.
- Square resizes bound EXIF-rotated and panoramic allocations. The renderer
  restores the original aspect and maps each crop axis separately. This wastes
  some pixels relative to an orientation-aware rectangular proxy; evaluate it
  before expanding the prototype.
- File-source identity and a lifecycle generation guard reject stale async
  completions. Clear renderer references before closing bitmaps.
- Original BinaryFiles, image cache, elements, history, vault files, and export
  paths remain authoritative. Export bypasses display proxies even if supplied.
- The renderer invalidates only images whose source mapping changes.

## Boundaries and validation

This is a local integration checkpoint against Excalidraw 0.18.140 and Obsidian
Excalidraw 2.28.1, not a published dependency. The fork source lives in the
gitignored `reference/excalidraw-obsidian` checkout on `codex/image-lod-140`.
The consumer checkout is `reference/obsidian-excalidraw-plugin`, on
`codex/image-lod-2281`. Preserve the fork source or a patch outside `reference/`
before relying on a fresh clone.

The source patch is preserved in
[current patch handoff](../patches/README.md).
Apply it at npm package commit `6a4e51cc8e343f484f47d306ac9c09e1db515cb0`,
build the fork's Obsidian artifacts, copy the four artifacts into the 2.28.1
consumer's ignored installed package, and build that consumer normally. Do not
edit its generated `main.js` to replace the embedded runtime.

The experiment starts disabled after reload. Enable it with **Toggle experimental
image LOD**. Diagnostics expose support, proxy count, approximate pixel bytes,
queue size, and whether generation is running through `getDiagnostics().imageLod`.

JPEG is the deliberate first scope. PNG, SVG, animated formats, persistent
IndexedDB caching, worker-managed encoded proxies, performance profiles, and
read-only Popout exports are outside this checkpoint. Startup still loads
original encoded files; this does not promise to eliminate first-load cost.

Before enabling by default, compare user-driven cold and warm navigation with
the same Board and route. Check main-window and Popout crop/flip/rotation,
high zoom returning to originals, PNG export while proxies are active, Board
switches, closing during generation, and unload/reload. Confirm the renderer
change reduces native decode stalls rather than relocating them.

The host verification passes (238 passed, one existing skip). The fork's
Obsidian artifact/type generation and the 2.28.1 consumer production build pass.
The fork's full monorepo typecheck has 365 diagnostics both before and after
this patch, with identical diagnostic text; the prototype introduces none.
Focused source selection tests and new-helper lint pass. Live navigation,
export pixels, restart, and Popout teardown remain manual validation gates.

The locally installed bundle was backed up under
`C:/Users/WXP/.codex/tmp/board-profile/excalidraw-2.28.1-backup-20261010/`
before replacing `main.js` and `styles.css`. Its manifest was preserved. Live
reload confirms both open views expose the seam and proxy generation succeeds;
original file-store identity and serialized elements remained unchanged. The
2.28.1 consumer bundle is 4,988,537 bytes. The first trial is enabled in the
current session with a temporary `window.__eprLodTrial` listener; restart still
defaults to disabled. This is functional inspection, not navigation benchmarking.

The user-driven trials still stuttered. The experiment is disabled in the
current session; see [the attribution investigation](../investigations/image-lod-attribution-trial.md).
Generation churn and unrelated host overlap-planning work were observed.
The independent overlap-planner optimization is installed, but neither it nor
the unpublished LOD seam has proven an end-to-end navigation improvement.
