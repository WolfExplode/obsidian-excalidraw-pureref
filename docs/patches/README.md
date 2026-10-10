# Smooth image navigation renderer handoff

The host plugin can run against public Obsidian Excalidraw, but worker-backed
JPEG navigation requires the narrow renderer changes in
[excalidraw-0.18.140-image-navigation.patch](excalidraw-0.18.140-image-navigation.patch).
The complete source delta is preserved here because `reference/` is gitignored.
Apply this patch alone; it replaces the earlier experimental patches.

## Matched source and build

- Renderer repository: `https://github.com/zsviczian/excalidraw.git`.
- Base npm 0.18.140 commit: `6a4e51cc8e343f484f47d306ac9c09e1db515cb0`.
- Renderer source: `reference/excalidraw-obsidian`, branch `codex/image-lod-140`.
- Paired implementation commit: `2b5ce9c1afb970357a0ac78ebf30e73825101fe5`.
- Consumer repository: `https://github.com/zsviczian/obsidian-excalidraw-plugin.git`.
- Consumer tag: `2.28.1`, commit `128a9ef4`; use a separate checkout such as
  `reference/obsidian-excalidraw-plugin-render-cache-test` to preserve other work.

With the renderer checked out at the exact base commit and dependencies installed
using Node 22+ and Corepack Yarn, apply the patch and build:

```powershell
git -C reference/excalidraw-obsidian apply ../../docs/patches/excalidraw-0.18.140-image-navigation.patch
corepack yarn --cwd reference/excalidraw-obsidian/packages/excalidraw build:obsidian
```

The build must produce all four files under `packages/excalidraw/dist/obsidian`:
`excalidraw.development.js`, `excalidraw.development.css`,
`excalidraw.production.min.js`, and `excalidraw.production.min.css`.

Install the matched consumer's normal dependencies, then copy those four files
into its ignored `node_modules/@zsviczian/excalidraw/dist/obsidian` directory.
Build the consumer with `npm run build` and use its generated `dist/main.js`
and `dist/styles.css` together. Do not edit the generated bundle, change the
consumer's manifest/version/settings, or replace an unrelated checkout's source.
The verified consumer bundle is 4,989,933 bytes. Local artifact copying changes
no dependency declaration or lockfile and does not publish a release.

For installation, disable the host plugin first, then Obsidian Excalidraw. Back
up the installed `main.js` and `styles.css`; copy both generated files into the
installed Excalidraw directory. Enable Excalidraw, then the host plugin. The
host automatically prepares previews if both provider callbacks are present.
**A public Excalidraw update replaces this custom renderer.** In that case the
host reports navigation optimization as unavailable and uses native rendering.

## Checks and scope

Run host `npm run verify`. In the renderer run `yarn test:update` with the three
`packages/element/tests/image{RenderSource,ZoomCache,ZoomRenderer}.test.ts` files,
helper/test lint, the Obsidian build and `yarn test:typecheck`. The full renderer
typecheck currently has 365 unchanged baseline errors; report them rather than
claiming a clean monorepo typecheck. The focused renderer suite has 14 tests.

The setting **Smooth image navigation** defaults on and persists through reload.
`getDiagnostics().imageNavigation` distinguishes `active`, `disabled`,
`unavailable` and `waiting-for-editor`, with per-view preview/detail counters.
Original files, elements, history and export pixels remain authoritative.

The host verification passes with 243 tests and one existing skip. The cleaned
renderer build, generated declarations, 14 focused tests and helper/test lint
pass. Live reload confirms automatic activation, persisted disabled/enabled
preferences, worker release on disable, all 484 JPEG previews restored without
errors, and unchanged original file bytes, image elements and Board geometry.
Reloading Excalidraw changed version/nonce metadata on 48 embeddables; no content,
geometry or element order changed. That reload metadata is separate from display
pixel preparation. The installed pre-cleanup renderer backup is under
`C:/Users/WXP/.codex/tmp/board-profile/excalidraw-before-image-navigation-20261010/`.

This commits a supported paired local implementation, not a published package
handoff. See [ADR 0017](../adr/0017-smooth-image-navigation.md) for the budgets,
JPEG scope, native fallbacks and measured evidence. Before broader distribution,
check cold startup, image replacement and transforms, PNG export, Board switches,
disable/re-enable, closing during decode and editable Popout teardown. Mixed-DPI
Popouts need separate validation. The most likely regression is soft detail
under memory pressure; native sources and unrelated main-thread work can still
pause navigation.
