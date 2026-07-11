# CASTLE CRASHER visual receipt

Status: **PASS** — real-pixel gates and native-size semantic comparison approved on 2026-07-10.

## Preserved evidence

- Game SHA-256: `01ed979cdb03666b5f0ff5b14c6d39d9fbce2f92c36cdc8789d6965032e8e36c`
- Fixed visual seed: `0xcc451e`
- Tracked contact sheet: `castle-crasher-contact-sheet.png`
- Contact-sheet SHA-256: `ad2af3441951293307fd55e3b0ba7f7a16f582960dd718dce9682e2cb20f3edf`
- Reference rows: MACHINE HUNT (`horizon`) and BLOCK MINE (`blockmine`), all cells reviewed at native 160×360.
- Checkpoints: `opening@12`, `announce@12`, `crew@8`, `flight@12`, `danger@12`, `collapse@24`, `warning@12`, `later@12`, `apex@24`.
- Full automated metrics: `.artifacts/visual/castle-crasher/metrics.json` after running `node evals/castle-crasher-visual-eval.js` from `here-now/`.
- Hash-bound six-category review: `../visual-reviews/castle-crasher.json`.

## Scale-law receipt

Drawn pixels were measured from clean-plate/isolated real renders, not logical hitboxes.

- Engineer crews: 13–15×16 px across spotter, cranker, and loader roles.
- Monarchs: 12–13×22 px.
- Projectile fixture: 12×16 px.
- Apple Trebuchet: 23×23 px.
- Bridge Ballista: 23–24×23 px.
- Bolt Harp: 23×24 px.
- Walking Bombard: 23×23 px.
- Both projectile approaches measure `0.80`, above the `0.55` runway floor.
- Normal-play summed actor footprint is `6.47%..6.84%`, below the `20%` cap.

## Authored-world and motion receipt

- Orchard, gorge, frost, and foundry environment-pair structure distances measure `0.294..0.344`; the compositions change landmarks, skyline, terrain grammar, atmosphere, and machine silhouette rather than only palette.
- Aligned animation peak changed-pixel fractions: crew `0.0281`, machine `0.0394`, projectile `0.1736`.
- Structural collapse peak: `0.0607` changed pixels across `35.56%` of the native spatial grid.
- Foundry breach peak: `0.0647` changed pixels across `35.56%` of the native spatial grid.
- The announced arc/target/collapse cone, gust warning, all four environments, physical masonry motion, and payoff-FX separation are executable gates in the visual eval.

## 60-second render receipt

Command:

```sh
node render/render.js castle-crasher 60 .artifacts/visual/castle-crasher/render/castle-crasher-60s.mp4 --seed 13387038 --probe --fps 30
```

- Simulation: 60 seconds at fixed 60 Hz.
- Encoded output: 1,800 frames at 30 fps, stride 2.
- MP4 bytes: `3,576,889`.
- MP4 SHA-256: `269f7efdff3f61f2fd685535ec3433646e0003c9a345bafe48bc7586537e509f`.
- Probe SHA-256: `7a1816bb01fcd78c5fde814767cce8474e001c10034dcb98709ab4b037cd72cc`.
- Probe result: finite, 18 progress marks, 0 repaths, maximum stall 398 frames (`6.6s`).
- Native filmstrip inspection confirmed the call → high arc → execution error → collapse → aftermath loop, alternating kingdoms, gust counter-aim, chapter changes, crew reactions, and breach presentation remain legible in motion.
