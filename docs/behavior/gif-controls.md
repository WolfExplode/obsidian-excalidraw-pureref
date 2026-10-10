# GIF playback and frame extraction

Select one local GIF embeddable on an editable Board to reveal Play/Pause,
previous/next frame, a frame scrubber, playback speed (0.25×–4×), and Extract.
Stepping, scrubbing, and extraction pause playback. Extract saves the displayed
full-resolution frame as a PNG in the configured attachment location and inserts
it beside the GIF in one undoable Excalidraw Automate operation.

The controls attach through the shared per-leaf scanner in the main window and
editable Popouts. Chromium's native ImageDecoder composites GIF frames (including
disposal and transparency); each decoded frame is closed immediately after
drawing. No full-animation bitmap cache is retained. A temporary canvas inside
the native embeddable retains upstream placement, opacity, clipping, and z-order.
The original GIF is unchanged. Playback loops with the GIF's frame durations.

Playback state is per open view and is not written to the Board. Deselecting hides
the toolbar but retains the paused frame or controlled playback until the view
closes. Unloading the host plugin restores the native GIF image. Image elements,
remote GIFs, multi-selection, and the F10 read-only window do not expose controls.
An unavailable native decoder leaves the original image visible and shows a Notice.

New extracted images use upstream Excalidraw Automate to register and persist
their files, following the existing PureRef import path. Before insertion, failures
delete only the newly created PNG. Once insertion has started, an unconfirmed
outcome retains the PNG to avoid deleting a possibly referenced attachment.

Manual verification: select a GIF in each editable window, pause, scrub quickly,
change speed, extract, undo/redo, and reopen the Board to confirm PNG persistence.
Close the Board or disable the host plugin during decoding to check cleanup.
