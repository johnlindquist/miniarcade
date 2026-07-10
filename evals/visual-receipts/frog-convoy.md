# FROG CONVOY visual release receipt

Date: 2026-07-10

Verdict: **PASS**

Candidate seed: `0xf09c0` (`985536`)

Reference games: MACHINE HUNT (`horizon`) and BLOCK MINE (`blockmine`)

## Preserved evidence

- Native 160×360 comparison: `evals/visual-receipts/frog-convoy-contact-sheet.png`
- Contact-sheet SHA-256: `97ce01385a42ddccba052b79645bd03c25ec52c296f8940bf6a51132a20f4595`
- Semantic review: `evals/visual-reviews/frog-convoy.json`
- Reproducible metrics and burst frames: `.artifacts/visual/frog-convoy/metrics.json` and `.artifacts/visual/frog-convoy/frames/`

The executable visual eval renders every fixture twice where it is reviewed,
checks deterministic RGBA, and captures these candidate checkpoints:

| Beat | Fixture frame | Evidence |
|---|---:|---|
| Opening readability | 12 | Lead anatomy, sanctuary, spring garden, full road/river stack |
| Normal play | 12 | Real lead hop plus delayed passenger hop on the traffic crossing |
| Expanded family | 12 | Five distinct passengers rallied at the midsummer mill race |
| Danger | 12 | Intact convoy reacting during the 210-frame flood warning |
| Sacrifice | 12 | Passenger leap, family recoil, guard arc, and road impact |
| Later environment | 12 | Flooded median/upper road, refuge islets, skiffs, drowned signs and buildings |
| Whole-family apex | 120 | Six-frog sanctuary tableau, gold sweeps, halo, and strip-wide fireflies |

Reference captures use MACHINE HUNT seed `0xa1020401` and BLOCK MINE seed
`0xb10c0050`, rendered at the same native size in the two lower contact-sheet rows.

## Motion receipt

Final stabilized source was rendered with:

```sh
node render/render.js frog-convoy 180 \
  .artifacts/visual/frog-convoy/frog-convoy-180s.mp4 \
  --seed 985536 --probe --fps 30
```

Receipt: exactly `180.000000s`, 5,400 output frames at 30fps from a fixed 60Hz
simulation, 26,510,773 bytes, MP4 SHA-256
`88d16511e3dfd5b32c2ac0af934aea45bc2e86f93d3377ec64f7e1566cb59f16`.
The renderer probe reports `finite: true`, `progress: 151`, `repaths: 0`, and a
worst progress stall of 1,001 frames (16.7s), so the final-art clip is active and
never stuck. Probe JSON SHA-256:
`566b7e890a1c811b8265c9ecb1d51648fe0512bbe45a2aec6ae1c2822fa4d29f`.

## Native-size reference grades

All categories were independently re-reviewed after an earlier level-variety
rejection. The rejected version retained the same road silhouette in Flood
Season; the approved version physically replaces the median and upper road lane.

| Category | MACHINE HUNT floor | BLOCK MINE floor | Approval note |
|---|---|---|---|
| Character craft | Meets | Meets | Built head/body/haunches, articulated legs, facing eyes, scarf/crown, leap and reaction poses; five passengers have distinct construction and delayed locomotion. |
| Environment craft | Meets | Meets | Layered sky, sanctuary, current, piers, authored logs and traffic, mill, bridge, reeds, then a constructed drowned middle with skiffs and refuge islets. |
| Level variety | Meets | Meets | Spring has three asphalt lanes and a garden; summer adds a mill race; autumn replaces the river skyline with a roofed bridge; flood removes a road lane and median under water. |
| Animation and impact | Meets | Meets | Flood crest anticipation, chain hopping, bodily sacrifice/recoil, sequential arrival, exact hold/slow/admire, broad gold sweeps, and persistent family tableau. |
| Readability | Meets | Meets | Bright frogs, dark-underlaid family ribbon, route arc, cracks, lights, warning chevrons, skiffs, logs, and HUD state remain separable at 160×360. |
| Art-direction cohesion | Meets | Meets | Rounded frog anatomy, outlined marsh materials, top-down traffic, seasonal landmarks, cyan navigation, gold reward, and coral danger share one visual grammar. |

Automated pixel gates are regression detectors, not the approval by themselves.
The hash-bound JSON review and the preserved native contact sheet record the
reference-based judgment that the candidate meets the release floor.
