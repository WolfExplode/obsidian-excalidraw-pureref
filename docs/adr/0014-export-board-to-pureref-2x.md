---
status: accepted
---

# Export Board images and text to PureRef 2.x

The host plugin offers a choice of selected elements or the entire current
Board, then writes a PureRef 2.x `.pur` interchange file from the images and
standalone text in that scope. PNG, JPEG, and GIF source bytes stay
embedded in the SQLite database. Crop, flip, rotation, placement, and opacity
are represented through the PureRef item and image transforms. Other image
formats are rasterized to PNG. Drawings, videos, embeds, and bound text are
skipped.

Standalone text exports at half its Excalidraw size relative to images. PureRef
stores editable notes with a 12 px inline font and a graphics-item transform;
the writer puts the fourfold Board-to-PureRef coordinate conversion and the
half-size text conversion in that transform.
Using an enormous CSS font instead displays as tiny text in PureRef.
The writer places each note's transform at the center of its Excalidraw text
box after scaling because PureRef draws notes around the transform origin.
It offsets the result by one sixteenth of the Board font size to the right and
one quarter downward to align PureRef's rich-text document inset.

The writer uses the recovered seven-table SQLite schema and rotated container
described in `docs/pur-2x-format.md`. Qt binary fields are stored as the
Latin-1-to-UTF-8 TEXT representation found in PureRef's own files. The export
uses a valid JPEG thumbnail and computes both image and container checksums.
PureRef 2.0.3's CLI was used to load a generated file, export an image and
scene, and resave a file containing editable text. A crop, flip, and rotation
were also checked through PureRef's scene export.
