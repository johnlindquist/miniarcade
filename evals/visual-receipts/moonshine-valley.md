# MOONSHINE VALLEY visual receipt

Status: **PASS** — real-pixel gates and native-size semantic comparison approved on 2026-07-10.

## Preserved evidence

- Game SHA-256: `c771598253918434aa6464877beaa770923cccb117092fce4fc9cc3eaf1dea7c`
- Fixed visual seed: `0x4d565931`
- Tracked contact sheet: `moonshine-valley-contact-sheet.png`
- Contact-sheet SHA-256: `63a39c10448f25c94ddae582472200f87cabe2cf637b8a1ed6ef102d73bf6fd4`
- Reference rows: MACHINE HUNT (`horizon`) and BLOCK MINE (`blockmine`), all cells reviewed at native 160×360.
- Checkpoints: `opening@12`, `growth@12`, `harvest@12`, `warning@12`, `night@12`, `danger@12`, `dawn@12`, `later@12`, `apex@12`.
- Full automated metrics: `.artifacts/visual/moonshine-valley/metrics.json` after running `node evals/moonshine-valley-visual-eval.js` from `here-now/`.
- Hash-bound six-category review: `../visual-reviews/moonshine-valley.json`.

## Scale-law receipt

Drawn pixels were measured from clean-plate/isolated real renders, not logical hitboxes.

- Farmer hammer and raised-arm celebration fixtures: 16–18×20–28 px.
- Four crop silhouettes across growth stages: 4–17×5–17 px.
- Mireling, moth, and boar: 13–19×14–17 px.
- Moonlamps: 12–16×23 px.
- Threat approach runway: `56.30%`, above the `55%` floor.
- Sampled normal-play summed actor footprint: `4.16%..7.49%`, below the `20%` cap.

## Authored-world and motion receipt

- Spring opening, summer night, autumn court, dawn, and frost-moon environment-pair structure distances measure `0.311..0.410`; the layouts change waterways, terraces, walls, landmarks, crop construction, foreground, and lighting rather than only palette.
- Aligned animation peak changed-pixel fractions: farmer `0.4455`, crop `0.0753`, creature `0.3711`, moonlamp `0.0547`.
- The 240-frame dusk warning changes `99.63%` of the native playfield sample before night lands and covers the full spatial grid.
- Isolated harvest payoff changes `0.20%` of world pixels; its follow-through peaks at `1.92%` across `15.56%` of the grid.
- Isolated frost-moon payoff changes `0.34%` of world pixels; its physical follow-through peaks at `3.20%` across `28.89%` of the grid.
- The four crop species, night light cones, route telegraphs, damage reaction, sunrise sweep, opening barn, stacked crates, and celebration pose are executable gates in the visual eval.

## 65-second render receipt

Command:

```sh
node render/render.js moonshine-valley 65 .artifacts/visual/moonshine-valley/render/moonshine-valley-65s.mp4 --seed 1297508657 --probe --fps 30
```

- Seed: `0x4d566931`.
- Simulation: 65 seconds at fixed 60 Hz.
- Encoded output: 1,950 frames at 30 fps, stride 2.
- MP4 bytes: `5,358,424`.
- MP4 SHA-256: `8c24cd0f9805f610cb22b48812b1bd1053d5e03409c1eabe3253397a4b2382d1`.
- Probe SHA-256: `8c4d9a1e011d9922e8f6b23e4e6462b8762c973df82e2ffc7d9ed3eb882e0b18`.
- Probe result: finite, 80 progress marks, 0 repaths, maximum stall 538 frames (`9.0s`).
- Native filmstrip inspection confirmed planting, watering, harvest carrying, the traveling dusk front, moonlamp defense, creature approaches, crop damage, sunrise rays, and dawn survival remain legible in motion.
