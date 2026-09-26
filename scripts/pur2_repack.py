"""Pack an edited SQLite database into a PureRef 2.x .pur container.

Usage: python scripts/pur2_repack.py original.pur edited.sqlite output.pur
The original header is retained; the thumbnail comes from metadata.thumbnail
in the edited database. Only Python's standard library is needed.
"""

import argparse
import hashlib
import sqlite3
import struct
from pathlib import Path

from pur2_extract import read_database


def repack(original: Path, sqlite_file: Path, output: Path) -> None:
    original_data = original.read_bytes()
    read_database(original)
    database = sqlite_file.read_bytes()
    if database[:16] != b"SQLite format 3\x00":
        raise ValueError("edited file is not a SQLite database")
    page_size = struct.unpack_from(">H", database, 16)[0]
    if page_size == 1:
        page_size = 65536
    page_count = struct.unpack_from(">I", database, 28)[0]
    if len(database) != page_size * page_count:
        raise ValueError("edited SQLite page count does not match file length")
    with sqlite3.connect(sqlite_file) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("edited SQLite database fails integrity_check")
        thumbnail = connection.execute("SELECT thumbnail FROM metadata LIMIT 1").fetchone()[0]
        if not thumbnail.startswith(b"\xff\xd8"):
            raise ValueError("metadata.thumbnail is not a JPEG")

    front_size = 108 + len(thumbnail)
    if front_size > len(database):
        raise ValueError("edited database is smaller than the front block")
    front = bytearray(original_data[:104] + struct.pack(">I", len(thumbnail)) + thumbnail)
    struct.pack_into(">Q", front, 14, len(database))
    body = bytes(front[104:]) + database[front_size:] + database[:front_size]
    front[40:104] = hashlib.md5(body).hexdigest().encode("utf-16-be")
    output.write_bytes(front + database[front_size:] + database[:front_size])
    read_database(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("sqlite_file", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    repack(args.original, args.sqlite_file, args.output)
    print(f"Packed {args.output}")


if __name__ == "__main__":
    main()
