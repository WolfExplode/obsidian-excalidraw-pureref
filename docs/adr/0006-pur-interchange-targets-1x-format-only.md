---
status: superseded by 0011 for import
---

# PureRef interchange is limited to the 1.x format

The import target in this decision was superseded by
[ADR 0011](0011-import-pureref-2x-into-current-board.md). The history below explains the
earlier scope decision.

PureRef interchange is not implemented in this plugin. If it is added, the
supported target is the reverse-engineered PureRef 1.10/1.11.1 format; PureRef
2.x files remain out of scope.

The original reason for excluding 2.x was an apparent inability to recover
image bytes without a local PureRef installation. That reason was resolved on
2026-09-26: saved 2.x files contain a complete SQLite database in rotated
order, and `scripts/pur2_extract.py` reads image bytes and basic geometry
without PureRef. See the
[PureRef 2.x format investigation](../investigations/pur-2x-format-investigation.md).

This ADR still records the current implementation scope: interchange is not
implemented, and the proposed 1.x target has not automatically expanded to
2.x. Reconsider the target in a new decision when interchange work begins,
using the standalone decoder and further tests of other 2.x releases and
non-image items. A possible 1.x implementation need not wait for that work.
