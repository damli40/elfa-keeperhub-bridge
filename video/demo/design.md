# Demo video design

Ported from `docs/architecture.html` (dark scheme) so the video and the checked-in
architecture page look like one product. Fonts swapped to HyperFrames built-ins.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| ground | #10141A | canvas |
| surface | #171C24 | cards, browser frames |
| surface-2 | #1F2632 | terminal, code |
| ink | #E8ECF2 | headlines, body |
| muted | #A5AFBE | labels (lifted from #939DAC for WCAG on video) |
| rule | #2C3440 | dividers, frame borders |
| flow | #3FA7C9 | accent: forwarded, arrows, focus (lifted from #1F6F8B for video) |
| refuse | #E0A24A | refused / dropped |
| stop | #E06A55 | guard hit, no spend |
| ok | #4CCB8A | success |

## Type

- Display and body: "Inter"
- Numbers, hashes, terminal: "JetBrains Mono", tabular figures

## Rules

- Every number on screen has a row in `video/STORYBOARD.md` fact provenance.
- Harness events are labelled as harness events. Only the expiry row is a real Elfa delivery.
- No secret-bearing surface. Screens are captures from `assets/`.
- Corners 10px. Borders 2px. No em dashes on screen.
