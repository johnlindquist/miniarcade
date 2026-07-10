# SWARM KEEPER visual release receipt

Date: 2026-07-10

Candidate seed: `0x6500`

Reference seed: `0x6500`

The [native-size comparison sheet](./swarm-keeper-contact-sheet.png) is arranged as
three 160×360 columns — **SWARM KEEPER / MACHINE HUNT / BLOCK MINE** — with opening
frames on the first row and later-environment frames on the second. It is generated
by `swarm-keeper-visual-eval.js` from the real `@napi-rs/canvas` renderer, not the
mock command-count harness.

## Reproduction

```sh
cd here-now
node evals/swarm-keeper-visual-eval.js

cd ..
node render/render.js swarm-keeper 360 \
  .artifacts/swarm-keeper-visual/swarm-keeper-360s.mp4 \
  --seed 25856 --probe --fps 30
```

The six-minute clip receipt completed with zero repaths, a 10.9-second maximum
story stall, and a finite probe. Review checkpoints were 5s, 60s, 120s, 240s, and
350s. They show the opening formation, a persistent crossing, a beetle line, the
meadow-to-canyon change, a larger returning swarm, and a later crossing. Separate
71s/75s frames verify the flood warning and land.

The executable pixel receipt uses these deterministic beats:

- opening after 300 simulation frames;
- a 62%-built bridge with assigned builders physically at the planks;
- one named downed member with rescuers, tethers, and fighters in place;
- FLOOD SURGE 90 frames into its 240-frame warning;
- the Star Garden after fifteen persistent job sites;
- an active tier-3 ALL ACROSS cue two frames after completion.

Opening pixel hash: `a5d3ed2de4ba`.

## Reference-based grade

| Category | Grade | Evidence at 160×360 |
|---|---|---|
| Character craft | Meets reference floor | The larger red keeper has a coat, face, hat/leaf, staff, pointing pose, facing, and alternating gait. Every follower has a head, eye, feet, role-colored clothing, a job accessory, and reaction/downed poses. All four role palettes survive native rendering (84/58/42/60 measured pixels); the 8-frame focal animation delta is 98 pixels. Individual followers remain intentionally tiny, so formation spacing and name callouts do the readability work. |
| Environment craft | Meets floor; below BLOCK MINE's density ceiling | Ground, road, foreground leaves, water, planks, shrines, brambles, beetle shells, memorial scarves, and gates use consistent multi-tone materials and ordered planes. Opening edge density is 6.3%, between MACHINE HUNT's 1.6% and BLOCK MINE's 10.2%; path/ground color distance is 71.6. |
| Level variety | Meets reference floor | The natural six-minute receipt moves from Dew Meadow into Ember Canyon while completed bridges and gates remain behind. The deterministic Star Garden comparison changes 98.0% histogram distance versus BLOCK MINE's measured 46.2% opening-to-three-minute change. Biomes also change props and landmark silhouettes, not only color. |
| Animation and impact | Meets reference floor | Assignment dots and pointing telegraph work; builders stand at planks, carriers tether to cargo, rescuers pull ropes, beetles skitter and flash, followers recoil at losses, and memorials persist. The flood warning contains 1,470 exact cyan pixels before land; the apex contains 2,166 gold pixels versus 29 in the opening, with 108 payoff-particle pixels measured over the actual apex actors. |
| Readability | Meets reference floor | The keeper focal crop measures 26 quantized colors and 19.3% edges versus MACHINE HUNT's 17 and 3.5%. The HUD keeps one plain verb, swarm count, place name, destination progress, and a named SAVE alert. The forward-biased camera leaves hazards and job sites visible above the group. |
| Art-direction cohesion | Meets reference floor | Warm cream characters, role accents, dark green ink, authored three-tone materials, and the four zone palettes remain coherent. Opening entropy is 2.92 with 151 quantized colors: richer than MACHINE HUNT without approaching an unstructured/noisy palette. |

No category is averaged against another: all six independently meet the comparison
floor. BLOCK MINE remains denser in raw environment construction; SWARM KEEPER earns
the bar through stronger crowd characterization, causal assignment staging, persistent
consequences, and a larger measured change of place.
