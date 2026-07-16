# SIDE/QUEST runtime

Thirty-three self-playing 160×360 games designed for the 4:9 side column beside 4:3 video.

## Layers

- `engine.js` owns the fixed 60 Hz clock, input/session routing, effects, recording, profiling, preview scheduling, and deterministic runtime RNG.
- `autoplay.js` is a headless, dependency-free behavior toolkit. It owns reusable selection, steering, memory, watchdog, lookahead, skill, and pathfinding mechanics—but no game policy or universal intent type.
- Each game owns sensors, tactics, its intent schema, physics, rendering, and story rules.
- `games.js` is the gallery/recording/eval manifest.
- `evals/harness.js` boots the browser-first games deterministically without rendering.

The preferred controller boundary is:

```text
sense(game state) -> human or bot controller -> game-owned intent -> game physics
```

## Run and record

Serve the repository root over HTTP, then open `index.html`:

```sh
npm run dev
```

Gallery cards render at 30 fps and pause when horizontally offscreen. Opening a game directly runs it at 60 fps.

Useful query parameters:

- `?seed=42` replays the engine RNG stream.
- `?profile=1` collects stage timing through `E.profileReport()`.
- `?record=60` turbo-renders a 60-second WebM at exact 60 fps timestamps.
- `?record=60&speed=1` records in realtime through `MediaRecorder`.

## Verify

The canonical commands use the current deterministic renderer and discovered eval suite:

```sh
npm run benchmark       # deterministic AEP scorecard and source-bound receipt runner
npm run verify          # renderer encode/probe test, then every eval
npm run verify:release  # full verify, then AEP catalog/release preflight
npm run verify:live     # production routes, catalog, runtime, cachebusters, headers
```

Pass a registered benchmark module after `--`, for example `npm run benchmark -- ./path/to/benchmark.js --profile release`; the runner writes canonical scorecard, diagnosis, provenance, event, artifact-index, and receipt JSON under `.artifacts/benchmarks/` unless `--no-write` is used.

`verify:release` is a source preflight, not a claim that CI or deployment artifacts exist. `verify:live` checks the evidence the current static deployment exposes; it does not assert a commit identity because the site has no deployment commit marker.

Individual simulations accept or print their replay seeds where applicable. The shared harness can advance simulation without traversing draw code:

```js
const {bootGame} = require('./evals/harness');
const game = bootGame('surfers', {seed: 42});
game.frames(36000, false); // ten simulated minutes, zero canvas calls
```

## Ambient Evidence Protocol v1

AEP v1 makes catalog evidence accounting explicit:

- `evals/game-contracts.js` contains exactly one contract entry per `games.js` game.
- An `aep1` entry has a behavior eval and the complete native visual chain: executable visual eval, semantic review JSON, and preserved reviewed PNG. This catalog status records release evidence; runtime-ledger migration is tracked separately.
- `evals/legacy-quality-debt.json` freezes the eleven games that already lacked that visual chain on 2026-07-13. Those entries may be resolved, but the set cannot expand; every new game must enter as `aep1`.
- `evals/catalog-eval.js` rejects catalog, eval, review, receipt, cachebuster, and count-copy drift. It also verifies preserved montage bytes against their semantic review hashes.
- Ordinary verification never creates or updates a semantic review or preserved montage. Use the explicit preservation command in `AGENTS.md` only after native-size review.

The catalog accounting slice does not claim that every game has migrated to the shared evidence ledger. The default deterministic benchmark is an independent five-game panel over GHOST SHIFT, PICO CAP, DUNGEON EXPRESS, TOWER PANIC, and RICOCHET FOUNDRY: each run must pass natural evidence, an active same-seed mechanic ablation, and an evidence-disabled simulation/RNG twin before the source-bound receipt passes. Release accounting still does not invent missing calibration, CI-attestation, or deployment-commit evidence; it records the evidence available now and fails closed when that evidence drifts.

## Add a game

1. Create a 320×720 backing canvas and include `engine.js` plus `autoplay.js` before the game script.
2. Keep simulation and rendering in separate `step` and `render` functions.
3. Return game-owned intents from both human and bot controllers; apply them through one physics path.
4. Add the page metadata to `games.js`.
5. Add deterministic competence, drama, progress, and manual-control fixtures under `evals/`.
6. Add a real-pixel `evals/<game>-visual-eval.js`: fixed-seed native-size captures,
   distinct environment/level checkpoints, animation and payoff bursts, a contact
   sheet against MACHINE HUNT and BLOCK MINE, and a current visual-review receipt.
   Mock canvas-call counts do not satisfy this gate.
7. Run `npm run verify`, inspect the rendered 160×360 contact sheet,
   and browser-check both the gallery preview and direct page. If browser inspection
   is unavailable, visual approval remains unverified and the game does not publish.

## Performance rules

- Keep Canvas and DOM calls in JavaScript. Use cached layers or batched sprites before considering a new renderer.
- Keep render-only randomness off the simulation RNG stream so preview, direct, headless, and recording modes remain replay-equivalent.
- Keep hot world state numeric and packed; avoid string keys inside collision or pathfinding loops.
- Use Workers for asynchronous generation or planning that can tolerate a versioned snapshot.
- A future WASM backend should accept coarse typed buffers (`findRoutesBatch`, `simulateCandidates`) and return compact results. Never cross the boundary per entity, tile, callback, or draw call.
- Preserve exact-frame recording. WebCodecs `realtime` latency mode may drop frames and is not the default here.
