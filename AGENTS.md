# Agent Guide

MINI/ARCADE is the canonical production repository for
[miniarcade.dev](https://miniarcade.dev). It contains the static gallery,
self-playing games, shared runtime, and deterministic eval suites.

Every game is watched, not played. Optimize every decision for the viewer.

## The quality floor

- **Fun to watch is the prime directive.** Competence is only a floor. A bot
  walking correctly toward an obvious destination is still dead air. The viewer
  should repeatedly get a readable setup, a prediction, pressure or choice, and
  an on-screen payoff.
- **The rendered game must meet the MACHINE HUNT / BLOCK MINE bar.** Characters,
  enemies, props, environments, level identity, animation, and impact must feel
  authored at native 160x360 size. Passing behavior tests cannot excuse primitive
  geometry, interchangeable rooms, weak silhouettes, or placeholder motion.
- **Prove quality with executable evals.** Visual judgment needs deterministic
  real-pixel fixtures, native-size reference comparison, measured scale/detail/
  motion gates, and a hashed semantic review receipt. Behavior needs multi-seed
  natural runs, a ten-minute soak, watchability bands, and causal same-seed A/Bs.
  Evals must fail the cheap or boring implementation they are intended to prevent.

## Level and environment contract: Zelda rooms, not pathfinding demos

Exploration games must be built as compact authored encounters. A room should
contain a dependency to understand, at least two plausible actions or routes, an
enemy or hazard with its own readable state, a response that changes the plan,
and a payoff that materially changes the room. Keys, switches, forms, relays,
pushables, guards, traps, gates, and shortcuts are useful when they interact;
collectibles placed at the end of corridors are not a puzzle.

Hard rules:

- Never render the bot's computed navigation path, breadcrumbs, waypoint line,
  or debug route. Do not make "route legibility" a visual-eval goal. Communicate
  intent through facing, pose, anticipation, enemy tells, landmarks, gates,
  objective state, and consequences in the world.
- Ordinary walking, turning, replanning, or crossing a graph junction does not
  count as entertainment and must not reset a dead-air clock.
- Enemies need agency beyond contact damage: patrol/guard/investigate/intercept/
  windup/attack/recover states as appropriate. Their behavior must force a
  visible dodge, counter, detour, timing choice, or plan reversal before contact.
- Levels need authored topology and state. Evals must inspect room count,
  branches/loops or equivalent choices, longest straight traversal, puzzle
  dependencies, and solvability across relevant player forms/inventory states.
- Natural-run evals must separately count puzzle transitions, enemy actions,
  player responses, combat/near-misses, and completions. Require multiple
  categories so one noisy counter cannot fake decision density.
- Carry a rolling dead-air ceiling that resets only on a viewer-visible tactical
  beat: puzzle-state change, enemy tell/engagement, player response, combat or
  near-miss, environmental reversal, or payoff. Set the band from a measured
  multi-seed sweep and report the distribution in the eval or audit.
- Include a causal ablation such as `__NO_ENEMY_AI`, `__NO_PUZZLE_PLAN`, or the
  narrowest honest switch. On identical seeds, prove that the live mechanic
  changes decisions during the setup/telegraph window while the baseline remains
  active and capable of progress.
- Visual evidence for this genre must include the room setup, puzzle dependency,
  enemy tell/pressure, player response, state-changing solve, and aftermath. A
  beauty shot plus totals is not proof of an entertaining level.

## Verify

Run `npm test` before every commit. New games must include focused eval coverage,
including a deterministic ten-minute autoplay soak that proves movement, activity,
and progress. Exploration/pathfinding games must also use the level-entertainment
contract in `evals/entertainment.js`; movement alone never satisfies that gate.

## Publishing and deployment

- `miniarcade.dev` is hosted on Vercel and deploys from the `main` branch of
  `johnlindquist/miniarcade`.
- To publish, ship, or deploy changes to `miniarcade.dev`, use the normal Git
  commit/push workflow after the complete test suite passes, then verify the live
  production route.
- Do not publish this site or its games to here.now as a substitute for the Vercel
  deployment. Use here.now only when the user explicitly asks for a here.now site,
  URL, preview, or Drive operation.

## Commit style

Use a plain one-line present-tense message in the form
`GAME NAME: what actually changed`, without attribution boilerplate.
