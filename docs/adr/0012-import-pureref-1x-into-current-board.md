---
status: accepted
---

# Import PureRef 1.x scenes into the current Board

The existing PureRef import command and `.pur` drop prompt accept the flat
PureRef 1.10 format also written by PureRef 1.11.1. A separate bounded reader
validates its header, checksum, image references, item records, and child
hierarchy, then emits the same placement model used by the 2.x importer. This
keeps attachment creation, Excalidraw insertion, and rollback in one path.

PureRef 2.x's “save as legacy” files use a header two bytes shorter and may add
fields after the child count. The reader accepts both forms. It was checked
against a 1.x file with 117 embedded PNGs and nested text, and against a
2.x-produced legacy file. An independently written 1.10 fixture covers image
references, duplicate placements, and child text in the test suite.

The import preserves embedded PNG pixels, placement transforms, crop polygons,
item order, and editable text content. It uses the Board's default text styling,
as the 2.x path does. Externally linked 1.x images without embedded pixels fail
explicitly; the importer does not silently omit them. PureRef drawing strokes
and editable group structure remain outside this import.
