# SIDE/QUEST runtime

Twenty self-playing 160×360 games designed for the 4:9 side column beside 4:3 video.

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

Serve this directory over HTTP, then open `index.html`:

```sh
python3 -m http.server 8765 --directory here-now
```

Gallery cards render at 30 fps and pause when horizontally offscreen. Opening a game directly runs it at 60 fps.

Useful query parameters:

- `?seed=42` replays the engine RNG stream.
- `?profile=1` collects stage timing through `E.profileReport()`.
- `?record=60` turbo-renders a 60-second WebM at exact 60 fps timestamps.
- `?record=60&speed=1` records in realtime through `MediaRecorder`.

## Verify

Run every discovered eval suite in parallel:

```sh
node here-now/evals/run-all.js
```

Individual simulations accept or print their replay seeds where applicable. The shared harness can advance simulation without traversing draw code:

```js
const {bootGame} = require('./evals/harness');
const game = bootGame('surfers', {seed: 42});
game.frames(36000, false); // ten simulated minutes, zero canvas calls
```

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
7. Run `node here-now/evals/run-all.js`, inspect the rendered 160×360 contact sheet,
   and browser-check both the gallery preview and direct page. If browser inspection
   is unavailable, visual approval remains unverified and the game does not publish.

## Performance rules

- Keep Canvas and DOM calls in JavaScript. Use cached layers or batched sprites before considering a new renderer.
- Keep render-only randomness off the simulation RNG stream so preview, direct, headless, and recording modes remain replay-equivalent.
- Keep hot world state numeric and packed; avoid string keys inside collision or pathfinding loops.
- Use Workers for asynchronous generation or planning that can tolerate a versioned snapshot.
- A future WASM backend should accept coarse typed buffers (`findRoutesBatch`, `simulateCandidates`) and return compact results. Never cross the boundary per entity, tile, callback, or draw call.
- Preserve exact-frame recording. WebCodecs `realtime` latency mode may drop frames and is not the default here.
