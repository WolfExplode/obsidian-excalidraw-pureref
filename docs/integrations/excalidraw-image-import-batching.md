# Excalidraw image import batching

The host plugin combines compatible plain-image insertion requests at the next
rendering boundary. A normal user reproduction on 2026-10-10 showed 94 imported
files producing 96 native insertion calls and 98 save requests. The native save
queue coalesced those requests into four writes, but each image still separately
merged the element array, registered files and requested a save. Packing itself
benchmarked at a median 1.4 ms for those 94 elements, so speculative packing
overlap was not the optimization target.

`src/image-import-batch.ts` wraps the live view's `addElements` method, called by
ExcalidrawAutomate's public `addElementsToView` API. The contract was checked
against the local community-plugin source: plain-image insertion registers
`images`, updates the scene, adds core binary files and then awaits the native
save. The batching helper delegates those steps together to the original method;
it does not implement file registration or replace the save queue.

`src/media-auto-pack.ts` installs this hook within its existing per-leaf scanner
lifecycle. Eligibility requires an active multi-file transaction and image paths
matching its pending candidates. Existing element IDs, cursor-relative insertion,
restore operations, groups, frames, bindings and unknown future flags bypass the
optimization. Different stacking or history-capture policies flush separately.
Native prepend ordering is preserved by reversing request order, while keeping
each request's internal order. Each caller receives the native commit's eventual
result or error, including save completion.

A frame is a batching boundary, not an import-completion condition or settle
timer. Incomplete or canceled imports do not hold already-loaded images waiting
for other files. Hidden documents schedule a microtask instead; visibility change
and pagehide flush pending work. Teardown submits queued work before restoring
the method. Stale scheduled callbacks cannot flush a later batch.

Native imports and animated-image replacement can still save or synchronize
older snapshots, so final packing and selection retain their existing queue-idle
conditions. Conversion requests bypass batching once the transaction finalizes.

The pure helper is tested for registration payload merging, stacking and capture
boundaries, caller completion, failures, partial flushes and teardown. Live
performance gains require another normal user import; unit tests establish the
batching contract, not real-world speed.
