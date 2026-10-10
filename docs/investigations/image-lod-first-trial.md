# Image LOD first trial — October 10, 2026

The user navigated the 561-image Board normally with experimental JPEG LOD
enabled. The lightweight main-renderer listener was stopped after completion.
Its 255.9-second elapsed window includes idle/background time, so percentile
frames are not a controlled navigation benchmark.

| Observation | Result |
| --- | --- |
| Recorded frames | 15,966 |
| Median / p95 / p99 interval | 6.1 / 12.1 / 24.3 ms |
| Tasks at least 50 ms | 56, totaling 18.943 s |
| Longest recorded task | 5.255 s |
| Final retained proxies | 300, all at the 128-pixel square tier |
| Approximate retained pixel bytes | 19,660,800 (18.75 MiB) |
| Final queued / budget-blocked work | 0 / 0 |
| Final desired images / failed sources | 267 / 3 |

The final cache demonstrates successful generation and off-screen retention
without budget pressure at the final 0.1 zoom. It does not reveal peak memory,
generation counts, tier churn, eviction counts, or whether long tasks came from
decoding, originals, proxy generation, saving, or other plugins. The maximum
31.1-second frame gap includes an unclassified background/focus gap and must
not be reported as a rendering stall.

Of the 321 file entries labelled JPEG, 318 had actual JPEG headers. The other
three had RIFF/WEBP headers under `data:image/jpeg` URLs. Their original pixels
remained in use. Eligibility now checks the JPEG byte signature before queueing
work, preserving the files while avoiding repeated attempts for unsupported
sources. A focused regression test covers it.

The final viewport also contained 146 images labelled `image/jfif`, 56 PNGs,
and one SVG in addition to 269 labelled JPEG. A byte-prefix inspection confirmed
that all 146 JFIF entries are JPEG data. Eligibility now accepts the JPEG MIME
aliases `jfif`, `jpg`, and `pjpeg` while requiring actual JPEG bytes. These were
previously outside the prototype's coverage despite being the same codec.
This expands supported coverage without re-encoding or changing original files.

The listener provides timings without CPU stacks or native decode attribution.
Next use a targeted CPU/native timeline capture for a matched user navigation
route, with LOD on and off; include proxy/cache counters and visible JPEG versus
unsupported-format coverage. Do not infer a speedup by comparing these
percentiles with earlier captures of different routes and durations.

The compact raw results are retained locally at
`C:/Users/WXP/.codex/tmp/board-profile/2026-10-10-lod-trial-1.json`.
The temporary listener is stopped. LOD remains enabled in the current session.

The user reports that it still stutters similarly. Do not treat this trial as
a perceptible improvement. A follow-up CPU/native timeline capture and temporary
bitmap-generation/source-publication timings are attached for attribution with
the corrected JFIF coverage. The follow-up is also user-driven.
