# PDF selection boundary fixture

`glyph-boundaries.pdf` is a small, hand-authored PDF (400 × 300 points) using the standard Times-Roman font. It contains no third-party paper content.

The first line starts at (50, 250), uses 24-point text and 0.5-point character spacing (`Tc`). The Times-Roman advances for `W` and `i` are 944 and 278 per 1000 em. Therefore `WiWi` has these horizontal glyph bounds:

| Glyph | Left | Right |
| --- | ---: | ---: |
| W | 50 | 72.656 |
| i | 73.156 | 79.828 |
| W | 80.328 | 102.984 |
| i | 103.484 | 110.156 |

Dragging from x=50.5 to x=105 must select `WiW`. The fourth glyph's midpoint is 106.82; a word-end expansion at 20% would incorrectly include it. Browser tests derive pointer and highlight positions from these PDF coordinates, independently of the text layer and the selection implementation, and compare copied text, saved text and persisted annotations at multiple zoom levels and drag directions.

The second line uses a `TJ` spacing adjustment, allowing manual inspection of explicit word spacing as well.
