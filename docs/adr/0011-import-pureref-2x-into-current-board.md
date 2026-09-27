---
status: accepted
---

# Import PureRef 2.x scenes into the current Board

The host plugin imports PureRef 2.0/2.1 `.pur` files into the currently open
Excalidraw Board using the recovered rotated SQLite container. This supersedes ADR 0006's
proposed 1.x-only target for imports. The original `.pur` remains untouched.
The command palette opens a file picker; dropping a `.pur` file onto an editable
Board offers a choice between importing its contents and linking the file through
Excalidraw's existing drop behavior.

The importer reads image bytes and placement geometry in the renderer with a
bundled SQLite reader. Obsidian's file manager chooses each attachment path from
the user's configured attachment settings, using the Board as the source file.
The Excalidraw community plugin's public ExcalidrawAutomate API inserts the
elements and registers their image files in one live-view commit. A placement
with a rectangular, unrotated, uncropped source keeps its original image file;
other placements are flattened to transparent PNGs to preserve their visible
crop and transform. Notes become editable text. Group hierarchy contributes
to placement geometry, and items are added in Z order.

PureRef placement coordinates and image dimensions map to 25% of their source
values on the Board, matching Alt+S's default image scale. PureRef's image
resizing and relative layout are retained. Notes take their font size from the
PureRef rich text (including inline overrides) and item transform, then use the
same 25% coordinate conversion as images. A native 9 pt note, for example,
stores a 12 px inline font size; multiplying that by the note transform gives
its size relative to the images. Imported notes use Excalidraw's Helvetica
family as the closest available match for PureRef's Open Sans.
PureRef's note transform is its visual center; the importer subtracts half of
the created Excalidraw text box so its top-left aligns with nearby media. It
also accounts for PureRef's half-em rich-text document inset.
Legacy plain-text notes use PureRef's 22 px default.

PureRef 2.x pen strokes are outside this import. This version also does not
recreate editable PureRef groups or note rich-text styling. Flattened animated
images retain the visible frame; unflattened GIFs keep their source file.
Unsupported image formats or perspective transforms fail visibly rather than
silently producing a misplaced element.
