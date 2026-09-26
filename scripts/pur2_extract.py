"""Extract a PureRef 2.x file's SQLite database, images, and basic geometry.

Usage: python scripts/pur2_extract.py input.pur output_directory
Only Python's standard library is required. This tool does not modify input.
"""

import argparse
import hashlib
import json
import sqlite3
import struct
from pathlib import Path


def read_database(path: Path) -> tuple[bytes, dict]:
    data = path.read_bytes()
    if len(data) < 108 or struct.unpack_from(">I", data)[0] != 6:
        raise ValueError("not a recognized PureRef 2.x file")
    thumbnail_size = struct.unpack_from(">I", data, 104)[0]
    front_size = 108 + thumbnail_size
    if front_size >= len(data):
        raise ValueError("invalid thumbnail length")
    checksum = data[40:104].decode("utf-16-be")
    if hashlib.md5(data[104:]).hexdigest() != checksum:
        raise ValueError("PureRef payload checksum mismatch")

    database_size = len(data) - front_size
    if struct.unpack_from(">Q", data, 14)[0] != database_size:
        raise ValueError("PureRef header database size does not match file layout")
    if data[database_size:database_size + 16] != b"SQLite format 3\x00":
        raise ValueError("SQLite header is not at the expected rotation point")
    database = data[database_size:] + data[front_size:database_size]
    page_size = struct.unpack_from(">H", database, 16)[0]
    if page_size == 1:
        page_size = 65536
    page_count = struct.unpack_from(">I", database, 28)[0]
    if page_size * page_count != database_size:
        raise ValueError("SQLite page count does not match reconstructed length")
    return database, {
        "format_version_tag": data[4:12].decode("utf-16-be").rstrip("\x00"),
        "application_version": data[26:36].decode("utf-16-be"),
        "thumbnail_bytes": thumbnail_size,
        "database_bytes": database_size,
    }


def qt_bytes(value: bytes) -> bytes:
    """Undo PureRef's byte-to-Unicode-to-UTF-8 storage of binary Qt values."""
    return value.decode("utf-8").encode("latin-1")


def matrix(value: bytes) -> list[float]:
    raw = qt_bytes(value)
    if len(raw) != 77 or raw[4] != 0:
        raise ValueError("unrecognized transform encoding")
    return list(struct.unpack_from(">9d", raw, 5))


def qt_size(value: bytes) -> list[float]:
    raw = qt_bytes(value)
    if len(raw) != 21 or raw[:5] != b"\x00\x00\x00\x16\x00":
        raise ValueError("unrecognized note size encoding")
    return list(struct.unpack_from(">2d", raw, 5))


def qt_rect(value: bytes) -> list[float]:
    raw = qt_bytes(value)
    if len(raw) != 37 or raw[:5] != b"\x00\x00\x00\x14\x00":
        raise ValueError("unrecognized scene rectangle encoding")
    return list(struct.unpack_from(">4d", raw, 5))


def painter_path(value: bytes) -> list[dict]:
    raw = qt_bytes(value)
    if raw[:8] != b"\x00\x00\x04\x00\x00\x00\x00\x00":
        raise ValueError("unrecognized PainterPath header")
    tag_length = raw[8]
    if raw[9:9 + tag_length] != b"QPainterPath\x00":
        raise ValueError("unrecognized PainterPath tag")
    count_offset = 9 + tag_length
    point_count = struct.unpack_from(">I", raw, count_offset)[0]
    points_offset = count_offset + 4
    if len(raw) != points_offset + 20 * point_count + 8:
        raise ValueError("unrecognized PainterPath length")
    return [
        {"type": struct.unpack_from(">I", raw, points_offset + 20 * i)[0],
         "x": struct.unpack_from(">d", raw, points_offset + 20 * i + 4)[0],
         "y": struct.unpack_from(">d", raw, points_offset + 20 * i + 12)[0]}
        for i in range(point_count)
    ]


def source_polygon(image_transform: list[float], bounds: list[dict]) -> list[list[float]]:
    """Map clipping path points from item space back to source pixel space."""
    a, b, c, d, e, f, g, h, i = image_transform
    determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if determinant == 0:
        raise ValueError("non-invertible image transform")
    inverse = [
        (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
        (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
        (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant,
    ]
    result = []
    for point in bounds:
        x, y = point["x"], point["y"]
        w = x * inverse[2] + y * inverse[5] + inverse[8]
        result.append([
            (x * inverse[0] + y * inverse[3] + inverse[6]) / w,
            (x * inverse[1] + y * inverse[4] + inverse[7]) / w,
        ])
    return result


def extract(path: Path, output: Path) -> dict:
    database, summary = read_database(path)
    output.mkdir(parents=True, exist_ok=True)
    db_path = output / "scene.sqlite"
    db_path.write_bytes(database)
    image_dir = output / "images"
    image_dir.mkdir(exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.text_factory = bytes
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != b"ok":
            raise ValueError(f"SQLite integrity check failed: {integrity!r}")
        type_by_id = {}
        for table, kind in (("items_images", "image"), ("items_notes", "note"),
                            ("items_groups", "group"), ("items_drawings", "drawing")):
            for (item_id,) in connection.execute(f"SELECT id FROM {table}"):
                type_by_id[item_id] = kind
        all_items = []
        for item_id, parent, name, z, opacity, locked, comment in connection.execute(
            "SELECT id, parent, name, z, opacity, locked, comment FROM items ORDER BY id"
        ):
            all_items.append({
                "id": item_id, "type": type_by_id.get(item_id, "unknown"),
                "parent": parent, "name": name.decode("utf-8") if name else "",
                "z": z, "opacity": opacity, "locked": locked, "comment": comment,
            })
        images = []
        for image_id, fmt, checksum, content, width, height in connection.execute(
            "SELECT id, format, checksum, data, width, height FROM images ORDER BY id"
        ):
            digest = hashlib.md5(content).hexdigest()
            if digest.encode("ascii") != checksum:
                raise ValueError(f"image {image_id} checksum mismatch")
            extension = fmt.decode("ascii").lower()
            if extension not in {"png", "jpg", "jpeg", "gif", "bmp", "webp"}:
                extension = "bin"
            filename = f"{image_id}.{extension}"
            (image_dir / filename).write_bytes(content)
            images.append({"id": image_id, "file": f"images/{filename}", "width": width, "height": height})
        items = []
        for item_id, parent, name, transform, image_id, image_transform, image_bounds in connection.execute(
            "SELECT items.id, items.parent, items.name, items.transform, "
            "items_images.image, items_images.image_transform, items_images.image_bounds "
            "FROM items JOIN items_images ON items.id = items_images.id ORDER BY items.id"
        ):
            image_matrix = matrix(image_transform)
            bounds = painter_path(image_bounds)
            items.append({
                "id": item_id,
                "parent": parent,
                "name": name.decode("utf-8") if name else "",
                "image_id": image_id,
                "transform": matrix(transform),
                "image_transform": image_matrix,
                "image_bounds": bounds,
                "source_crop_polygon": source_polygon(image_matrix, bounds),
            })
        notes = []
        for note_id, text_color, fixed_size, background_color, body, style in connection.execute(
            "SELECT id, text_color, fixed_size, background_color, text, style "
            "FROM items_notes ORDER BY id"
        ):
            notes.append({
                "id": note_id,
                "text_color": text_color.decode("utf-8") if text_color else None,
                "fixed_size": qt_size(fixed_size),
                "background_color": background_color.decode("utf-8") if background_color else None,
                "html": body.decode("utf-8") if body else "",
                "style": style,
            })
        groups = []
        for group_id, background_color, lock_mode in connection.execute(
            "SELECT id, background_color, lock_mode FROM items_groups ORDER BY id"
        ):
            groups.append({
                "id": group_id,
                "background_color": background_color.decode("utf-8") if background_color else None,
                "lock_mode": lock_mode,
            })
        drawings = [row[0] for row in connection.execute("SELECT id FROM items_drawings ORDER BY id")]
        scene_rect, view_transform, horizontal_scroll, vertical_scroll, saved = connection.execute(
            "SELECT scene_rect, view_transform, horizontal_scroll, vertical_scroll, saved "
            "FROM metadata LIMIT 1"
        ).fetchone()
        metadata = {
            "scene_rect_xywh": qt_rect(scene_rect) if scene_rect else None,
            "view_transform": matrix(view_transform) if view_transform else None,
            "horizontal_scroll": horizontal_scroll,
            "vertical_scroll": vertical_scroll,
            "saved": saved,
        }
    summary.update({"items": all_items, "images": images, "image_items": items,
                    "notes": notes, "groups": groups, "drawing_ids": drawings,
                    "metadata": metadata})
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    summary = extract(args.input, args.output)
    print(f"Extracted {len(summary['images'])} images and {len(summary['image_items'])} image items to {args.output}")


if __name__ == "__main__":
    main()
