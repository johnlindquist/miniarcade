# HOTEL HAUNT visual release receipt

Date: 2026-07-10

Verdict: **PASS**

Candidate seed: `0x484854` (`4737108`)

Reference games: MACHINE HUNT (`horizon`) and BLOCK MINE (`blockmine`)

## Preserved evidence

- Native 160×360 comparison: `evals/visual-receipts/hotel-haunt-contact-sheet.png`
- Contact-sheet SHA-256: `2b8885c531a641d7795f3d1fcb895fecada80303e5f18002e15547ea32fd217c`
- Candidate game SHA-256: `d874beb1a1a847e7e3de54e2d4f3521e80625a91979b39f108f9c788f99db411`
- Hash-bound semantic review: `evals/visual-reviews/hotel-haunt.json`
- Reproducible metrics and burst frames: `.artifacts/visual/hotel-haunt/metrics.json` and `.artifacts/visual/hotel-haunt/frames/`

The executable real-canvas eval captures opening readability, the visible
containment plan, sweep motion, possession reveal, vent flight, a broken plan,
floor relight, moon suites, thermal spa, the exact act warning, midnight
check-in, the concierge fight, and the wing-relit apex. The lower montage rows
use fixed-seed MACHINE HUNT and BLOCK MINE frames at the same native size.

## Scale-law receipt

Drawn-pixel isolation against a clean plate measured every actor family and all
twenty-four furniture silhouettes:

| Family | Measured maximum | Contract |
|---|---:|---:|
| Hunter and routine ghosts | 19×29px | ≤20×32px |
| Furniture structures | 24×22px | ≤24×24px |
| Set-piece concierge | 30×34px | ≤34×34px |

The strict summed bounding-box footprint includes every active-floor actor and
structure plus all visibly possessed furniture on preview floors; cleared,
static furniture is environmental set dressing. It measured 12.35% for the
plan, 13.20% in the broken-plan chase, 13.10% in the spa, and 16.08% in the
concierge encounter, all below the 20% ceiling. Every furniture-to-vent threat
route measured at least 93.07% of its available travel axis, above the 55%
approach-room floor.

## Motion receipt

Final source was rendered through the offline fixed-60Hz path with:

```sh
node render/render.js hotel-haunt 60 \
  .artifacts/visual/hotel-haunt/hotel-haunt-60s.mp4 \
  --seed 4737108 --probe --fps 30
```

Receipt: exactly 60 seconds and 1,800 output frames at 30fps from a 60Hz
simulation; 6,097,392 bytes; MP4 SHA-256
`6ea0afd03c13d90d5be7fa4ae1af797888b8cba87f2c8a3df4b4dc198ee2c7ef`.
The renderer probe reports `finite: true`, `repaths: 0`, ten progress marks,
and a 955-frame (15.9-second) maximum story stall. Probe JSON SHA-256:
`3ebd0491491b1054d939064cfaa868061849012dea0a445dfb35c88343f65d1f`.

## Native-size reference grades

| Category | Grade | Evidence at 160×360 |
|---|---|---|
| Character craft | Meets both references | The cap, face, coat, gait, backpack and hose build a readable hunter; sweep, vacuum, brace and spook poses change the body. Wisp, rascal, luggage bellhop and hatted concierge have distinct silhouettes and reactions. |
| Environment craft | Meets both references | The facade entrance, masonry, elevator spine, vents, cornices, sconces, room shells and authored furniture make a built hotel with foreground, room and exterior separation. |
| Level variety | Meets both references | Lobby arches/chandelier, suite windows/bedroom props, spa tiles/pipes/fountain and ballroom curtains/instruments change landmarks and composition, not only color. |
| Animation and impact | Meets both references | Pixel bursts prove gait, sweep arc, ghost motion, furniture tell, reveal, vent transit, suction, check-in, capture and broad relight follow-through. |
| Readability | Meets both references | Numbered cyan plan points, plain-language intent, ward marks and possession eyes stay clear while the cast remains tiny and every approach retains long runway. |
| Art-direction cohesion | Meets both references | Spectral cyan/lilac consistently means haunting; brass/cream means containment and relight; the four wing palettes remain one nocturnal hotel language. |

Automated pixel gates are regression detectors, not the approval by themselves.
The tracked native montage and six-category review record the reference-based
judgment; all categories independently meet the floor.
