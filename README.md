# MINI/ARCADE

The source for [miniarcade.dev](https://miniarcade.dev): twelve self-playing,
portrait arcade games built for the 4:9 side column beside 4:3 video.

This repository is the canonical home for the games and the Vercel production
pipeline. It was split from the original `youtube-slides/here-now` bundle so
game releases no longer depend on here.now publishing.

## Run locally

```sh
npm run dev
```

Open <http://localhost:8765>. The landing page is an accordion carousel:
desktop hover or keyboard focus reveals a full 4:9 preview, while touch devices
swipe between full cards. Open a game to use its controls or record a clip.

Useful game query parameters:

- `?seed=42` replays the deterministic engine RNG stream.
- `?profile=1` collects stage timing through `E.profileReport()`.
- `?record=60` turbo-renders a 60-second WebM at exact 60fps timestamps.
- `?record=60&speed=1` records in realtime through `MediaRecorder`.

## Verify

```sh
npm test
```

The dependency-free suite discovers every `evals/*-eval.js` file and checks the
shared runtime, carousel contract, game mechanics, deterministic autoplay,
manual controls, rendering, and long simulated runs.

## Architecture

- `index.html` is the MINI/ARCADE carousel and recording launcher.
- `games.js` is the shared game manifest.
- `engine.js` owns the fixed 60Hz clock, input/session routing, effects,
  recording, profiling, preview scheduling, and deterministic runtime RNG.
- `autoplay.js` provides reusable, dependency-free AI behavior primitives.
- Each game is a standalone HTML file with a 320x720 backing canvas and a
  160x360 logical viewport.
- `evals/harness.js` boots the browser-first games deterministically without
  rendering a real DOM.

The controller boundary is:

```text
sense(game state) -> human or bot controller -> game-owned intent -> game physics
```

## Add a game

1. Create a 320x720 backing canvas and include `engine.js` plus `autoplay.js`
   before the game script.
2. Keep simulation and rendering in separate `step` and `render` functions.
3. Return game-owned intents from both human and bot controllers and apply them
   through one physics path.
4. Add the page metadata to `games.js`.
5. Add competence, drama, progress, and manual-control fixtures under `evals/`.
6. Run `npm test` and verify both the carousel preview and direct game page.

## Deploy

Vercel deploys the `main` branch of `johnlindquist/miniarcade` to
`miniarcade.dev`. There is no build step or runtime service; the repository root
is the static deployment.
