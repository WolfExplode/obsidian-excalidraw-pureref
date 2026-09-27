---
status: accepted
---

# Export Board images as PureRef 1.x interchange

The host plugin exports every live image placement and standalone text on the current Board to a
user-chosen `.pur` file. It writes PureRef's documented 1.10 flat format, which
PureRef 1.11 also uses and PureRef 2.x can produce as a legacy file. The Board
remains the editable source of truth.

Each image, including a GIF's visible frame, is flattened to a PNG before writing. This preserves its visible
crop, flip, rotation, opacity, and layout while keeping the writer independent
of PureRef 2.x's still partially understood SQLite metadata. Placement
coordinates and sizes are multiplied by four to invert the importer's 25%
scale. Image and text order is preserved. Drawings, video, and embeds are outside
this export. PureRef 2.x export is specified separately in ADR 0014.

Unsupported or unavailable media are skipped. A supported image with invalid
geometry fails visibly rather than producing a misplaced item.
