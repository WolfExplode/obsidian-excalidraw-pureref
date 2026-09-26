# PureRef 2.x `.pur` format

This is a working format specification verified against files saved by
PureRef 2.0.3 and 2.1.0.beta4. For the
experiment history, including rejected interpretations, see the
[investigation](investigations/pur-2x-format-investigation.md).

## Container

All integers below are big-endian unless noted. Let `T = 108 + thumbnail_size`
and `D = file_size - T`.

| File offset | Size | Value |
| --- | ---: | --- |
| 0 | 4 | Magic integer `6` |
| 4 | 8 | UTF-16BE file-format tag, null-padded; `2.1` in both tested app releases |
| 12 | 2 | Zero in tested files; purpose unknown |
| 14 | 8 | `D`, the complete SQLite database length |
| 22 | 4 | Integer `10`, length of the next string in bytes |
| 26 | 10 | UTF-16BE application version, e.g. `2.0.3` or `2.1.0` |
| 36 | 4 | Integer `64`, length of the next string in bytes |
| 40 | 64 | Lowercase hexadecimal MD5 of `file[104:]`, UTF-16BE |
| 104 | 4 | Thumbnail JPEG byte length |
| 108 | Variable | Thumbnail JPEG |
| `T` | `D - T` | SQLite database bytes `[T:D)` |
| `D` | `T` | SQLite database bytes `[0:T)` |

The complete SQLite database is `file[D:] + file[T:D]`. Its header begins at
file offset `D`, so searching for `SQLite format 3\0` and reading through EOF
recovers only its first `T` bytes. The reconstructed database has the page
count and page size declared in its SQLite header and passes
`PRAGMA integrity_check` on every tested file.

## SQLite schema

The observed tables are `images`, `metadata`, `items`, `items_images`,
`items_drawings`, `items_notes`, and `items_groups`. `items.id` identifies a
placed item; its type-specific row uses the same ID. `items_images.image`
references `images.id`, allowing multiple placed instances of one source
image. `items.parent` encodes hierarchy (`-1` for top-level items in samples).
`images.data` contains the original source bytes, with `images.format`,
`width`, `height`, and an MD5 checksum. The one-image PNG BLOB was byte-identical
to its source; all 74 image BLOBs in the largest tested file matched their
stored checksums. A 2.0.3 animated GIF specimen retained its original GIF
bytes (`format='gif'`, 500×370); its `items_images.playback_state` was `3`,
versus `0` for tested still images. `playback_speed` was `1.0`,
`playback_frame` was `0`, and `flags` was `1` in both cases; the playback-state
enum has not yet been mapped. `metadata` contains scene, view, thumbnail,
and save/load information. Its `thumbnail` BLOB is byte-identical to the
front-block JPEG in all tested files, including the 74-image specimen. The
full `CREATE TABLE` statements are in the
[investigation](investigations/pur-2x-format-investigation.md#recovered-schema).

Some columns declared `BLOB` are actually stored with SQLite `TEXT` storage
class. To recover their binary Qt stream, read raw UTF-8 bytes, decode as
UTF-8, then encode the resulting code points as Latin-1. Reading them through
SQLite's `length()` or Python's default text conversion can truncate or alter
the apparent content at embedded zero bytes.

## Image geometry

`items.transform` and `items_images.image_transform` each decode to 77 bytes:
big-endian `0x50`, one zero byte, then nine big-endian 64-bit floats in Qt
`QTransform` order `[m11,m12,m13, m21,m22,m23, dx,dy,m33]`. For a source
point `(x,y)`, the result is

```
X = (m11*x + m21*y + dx) / (m13*x + m23*y + m33)
Y = (m12*x + m22*y + dy) / (m13*x + m23*y + m33)
```

The image transform maps source pixels into item coordinates; the item
transform then maps those coordinates into scene coordinates. In the default
one-image sample, the first translates by `(122,78)` and the second by
`(-471,-488.5)`, centering a 942×977 source image at the item origin.

`metadata.view_transform` uses the same matrix encoding. `metadata.scene_rect`
decodes to big-endian `0x14`, one zero byte, then four big-endian doubles
`(x, y, width, height)`. The centered one-image 2.0.3 scene has
`(-471,-488.5,942,977)` and an identity view transform. Both fields can be
NULL in an empty scene.

`items_images.image_bounds` is a `QPainterPath` clip in item coordinates. Its
decoded bytes have an eight-byte prefix `00 00 04 00 00 00 00 00`, a one-byte
tag length, the null-terminated `QPainterPath` tag, a four-byte point count,
then that many points. Each point consists of a four-byte type and two
big-endian doubles `(x,y)`. Eight trailing bytes are zero in tested samples.
Applying the inverse image transform to the path points yields the visible
polygon in source pixel coordinates. A cropped 1080×1080 sample resolves to
`x≈299.658..1080`, `y≈381.737..661.212`; PureRef's cropped image export is
781×280 pixels, consistent with the predicted dimensions after rounding.

`items.z` provides an ordering number in the tested scenes. `sort_order`
contains a tagged `BigRational` value; its complete integer encoding has not
been verified.

## Notes and groups

A controlled 2.0.3 scene with one image and one new note has two `items`
rows and one `items_notes` row. The note's `id` joins to `items.id`; its
`text` column contains Qt rich-text HTML (`qrichtext` metadata and HTML body),
and `background_color` contains a color string such as `#d9ffffff`.
`text_color` was NULL and `style` was `1` in this sample. `fixed_size` uses
the same UTF-8-wrapped Qt binary encoding: big-endian `0x16`, a zero byte,
then two big-endian doubles. Both values were `-1` for the auto-sized note.

Grouping two images in 2.0.3 adds a row to `items_groups` and a shared base
`items` row with the same ID. The group has `parent=-1`; both image items
change their `parent` to the group ID. Its `background_color` was NULL and
`lock_mode` was `0` in this sample. This confirms the `items.parent` field
represents the hierarchy, rather than a visual grouping hint.

The path point type enum, rich-text formatting variants, drawing payload,
and complete `BigRational` encoding remain open.

## Writing the container

Given a valid edited SQLite database, preserve the original 104-byte header,
copy `metadata.thumbnail` into the front JPEG block, replace bytes 14–21
with the edited database length, rotate the database into `[T:D)` followed by
`[0:T)`, and recompute the MD5 field at bytes 40–103 over everything from
file offset 104 to EOF. If the thumbnail BLOB itself has not been regenerated,
it can still preview the previous scene until PureRef saves again.
`scripts/pur2_repack.py` implements this operation.

This was tested by changing an image's X translation from `0` to `222` in a
2.0.3 database, repacking it, and loading and resaving the result through
PureRef 2.0.3. The PureRef-resaved file retained the X translation of `222`.
Replacing `metadata.thumbnail` with a different-length JPEG and repacking
also produced a file that PureRef 2.0.3 reopened and resaved successfully.

## Reader and validation

Run `python scripts/pur2_extract.py input.pur output_directory` from the
repository root. It writes `scene.sqlite`, `images/`, and `summary.json` with
item types and hierarchy, image item transforms and source crop polygons,
note HTML and size, group properties, and scene/view metadata. It checks the PureRef payload MD5,
declared database length, SQLite integrity, and each image BLOB's MD5.
To pack a modified database, run
`python scripts/pur2_repack.py original.pur edited.sqlite output.pur`.

Validated 2.0.3 files: one image, two images, a two-image cropped scene
re-saved from a 2.1 file, one image plus a note, two grouped images, and one
animated GIF.
Validated 2.1.0.beta4 files: empty, one image,
moved/resized image, two images, five images, 74 images (116 MB), and an
additional two-image crop example. The 2.0.3 crop retained identical decoded
source coordinates after reopening and saving through the 2.0.3 executable.
