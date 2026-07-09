# SIDE/QUEST performance receipts

Measured 2026-07-09 on the local development machine. These are regression receipts, not universal browser benchmarks.

## Runtime scheduler

`node evals/engine-eval.js` simulates a 120 Hz display in preview mode:

```text
119 simulation steps
60 renders, including initial paint
0 hidden-document steps
0 canvas calls during direct headless stepping
```

The engine now renders only after simulation advances. Gallery previews draw every other 60 Hz step, while direct pages and recordings remain 60 Hz. Horizontally offscreen gallery iframes receive a pause message.

Render-only effects use a private visual PRNG, so drawing at 0, 30, or 60 fps cannot advance the seeded simulation stream. The engine eval locks 3,600-step rendered/headless parity for Pocket League, Word Fall, and Web Slam.

## Headless simulation

| Suite | Before | After | Main change |
|---|---:|---:|---|
| Side Surfers | 2.64s | 0.91s | deterministic direct stepping; no draw traversal |
| Small Guys | 1.39s | 0.88s | deterministic direct stepping; no draw traversal |
| Meat Lad | 10.75s | 3.63s | packed tile keys/row masks; reused rollout buffers |
| Block Mine | 19.41s | 2.48s | packed/cached world; event-driven discovery; heap A*; route budgets |

Meat Lad also reduced retired instructions by roughly 60% in the sampled native profile. Block Mine’s controlled single-seed autonomous simulation fell from 7.17s to roughly 1.25s.

## Canvas command volume

Steady-state static-layer eval:

| Game | Before | After | Reduction |
|---|---:|---:|---:|
| Pocket League | 87 | 76 | 12.6% |
| Word Fall | 458 | 42 | 90.8% |
| Web Slam | 269 | 83 | 69.1% |
| Aggregate | 814 | 201 | 75.3% |

Pads, anchors, particles, and other animated overlays remain live. Web Slam’s city/court cache is explicitly tested to rebuild once when its city seed changes.

## Why JavaScript remains the primary backend

The controller layer is branchy and works over small game-owned objects; its measured cost is negligible. Canvas2D and WebCodecs remain browser-native. Moving either across a JS/WASM boundary would add complexity without addressing the measured bottlenecks.

The code is WASM-ready where it matters:

- deterministic seeds;
- packed integer world keys and row masks;
- typed-buffer-friendly path and rollout contracts;
- coarse `findPath` / `simulateCandidates` boundaries;
- simulation separated from rendering.

Consider an optional WASM backend only when simulation exceeds roughly 25–30% of turbo wall time after browser profiling, packed A* still has material p95 spikes, or bulk eval workloads grow to thousands of concurrent seeds.

## Reproduce

```sh
node here-now/evals/run-all.js
node here-now/evals/static-layer-eval.js
node here-now/evals/engine-eval.js
node here-now/evals/meatlad-eval.js --seed 1
node here-now/evals/blockmine-eval.js
```
