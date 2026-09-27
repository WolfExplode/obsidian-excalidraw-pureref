---
status: accepted
---

# Export Board images and text to PureRef 2.x

The host plugin writes a PureRef 2.x `.pur` interchange file from the current
Board's images and standalone text. PNG, JPEG, and GIF source bytes stay
embedded in the SQLite database. Crop, flip, rotation, placement, and opacity
are represented through the PureRef item and image transforms. Other image
formats are rasterized to PNG. Drawings, videos, embeds, and bound text are
skipped.

The writer uses the recovered seven-table SQLite schema and rotated container
described in `docs/pur-2x-format.md`. Qt binary fields are stored as the
Latin-1-to-UTF-8 TEXT representation found in PureRef's own files. The export
uses a valid JPEG thumbnail and computes both image and container checksums.
PureRef 2.0.3's CLI was used to load a generated file, export an image and
scene, and resave a file containing editable text. A crop, flip, and rotation
were also checked through PureRef's scene export.
