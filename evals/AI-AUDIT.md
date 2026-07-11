# SIDE/QUEST Bot Intelligence Audit

Audit of the AI in the original eleven self-playing games, the proven-improvement
log for later additions, and a plan for evals that measure what actually matters:
**fun to watch, sometimes creative, never stuck**.

Date: 2026-07-09. Sources: every game's inline bot code, `autoplay.js`, `engine.js`,
`evals/*.js`, and git history.

## Scorecard

| Game | Intelligence | Variety/Creativity | autoplay.js usage | Deliberate imperfection | Eval watchability coverage |
|---|---|---|---|---|---|
| SCRAP SHIFT | 5/5 — A* over nav graph, intercept solving, target hysteresis, roles | 4/5 — four personas (VOLT/FORK/BULWARK/WISP), director set-pieces | `findPath`, `controllerMux` | plan-duration jitter, fire spread | **Best in repo**: damage-lull cap, low-speed cap, mode presence, action bands |
| MEAT LAD | 5/5 — model-predictive: simulates real physics over jump candidates | 3/5 — depth-scaled deliberate fumbles (`err` up to 0.3) | **none** (doesn't load it) | yes — intentional under-powered jumps | progress + solvability only; can't tell clean play from warp-rescues |
| BLOCK MINE | 4/5 — weighted A* w/ state-dependent costs, trips, combat tactics | 3/5 — world seed + seeded tower blueprints; **no persona** | `BinaryHeap` only | none | rich competence floors + 30m never-stuck seed search; no variety/pacing metric |
| DEADLINE DECK | 4/5 — ETA obstacle projection, multi-objective priorities | 4/5 — full `skillProfile` (reaction 2-4f, lapses) | `controllerMux`, `skillProfile` | yes — lapses (chance .00034) | strong bands, but **lapse firing never asserted** |
| SIDE SURFERS | 4/5 — TTC lane analysis, roof-ride landing planning | 4/5 — "perfect bot that stumbles" lapse profile | `controllerMux`, `skillProfile` | yes — visible trips w/ `!` bubble | perfect-run + death band (1–14); no loot/variety assert |
| HORIZON | 3/5 — stealth state machine, LoS, per-type machine AI; no pathing | 3/5 — variety from machines, not Aloy | `nearest`, `bestBy`, `progressWatchdog` | none | meters/kills/downs floors only; no lower bound on downs, watchdog firings uncounted |
| WORD FALL | 3/5 — reactive survival; altar solver is **omniscient (cheats)** | 4/5 — word RNG, floor-scaled enemy mix, build branching | `nearest`, `wrappedDistance`, `controllerMux` | none | kills/deaths/swarm bands; **never asserts a word gets solved in autonomous runs** |
| SMALL GUYS | 3/5 — greedy platform hopping, sweeper timing | 4/5 — per-bean skill+bias, star "clutch" mode | `bestBy`, `controllerMux`, `progressWatchdog` | yes — weak beans wander | completion + star floor; teleport re-seats invisible to eval |
| WEB SLAM | 3/5 — ballistic prediction, off-stage recovery | 3/5 — random action gates (.09/.07/.035) | `controllerMux`, `bestBy` | yes — probabilistic actions | goal/KO/let bands; no rally-length distribution, symmetric AIs |
| HEX CASCADE | 2/5 — greedy 1-ply argmax over swaps | 2/5 — only `random()*.35` tie-break | **none** | tie-break noise only | excellent pacing-curve + band evals (ironically better than its AI) |
| POCKET LEAGUE | 2/5 — current-position greedy, no ball prediction | 2/5 — spectacle (per-car blasts), not brains | `controllerMux` only | steer/throttle jitter | tightest outcome bands (goals 10–30, demos 2–20); no possession/blowout check |

## Finding 1 — Toolkit adoption is inversely correlated with intelligence

The smartest bots (Meat Lad, Scrap Shift, Block Mine) hand-roll nearly everything;
`simulateCandidates`, `searchPath`/`findPath`, `createMemory`, `firstApplicable`,
`seek`/`flee`/`steer`, and `generateValidated` are essentially unused across all
original eleven games (Meat Lad doesn't even load `autoplay.js` — it needs bit-identical
physics as ground truth, which is legitimate).

Implication: don't force planner consolidation — games rightly own tactics. The
consolidation win is the **watchability layer**: `skillProfile`, personas, watchdogs,
and standardized telemetry, which are game-agnostic. Only 3 of the original 11 games use
`skillProfile`; only 2 use `progressWatchdog` while all original eleven hand-roll stall guards.

## Finding 2 — Anti-stall scar tissue is the repo's dominant pattern

Every game carries hand-rolled stall/deadlock escapes, and git history shows they were
added reactively after watching bad footage:

- Block Mine: SMART REPATH watchdog, depth-stall watchdog, entombed breaker, pogo guards, respawn death-spiral guards, golem timeout.
- Meat Lad: 3-tier rocket → warp escalation, off-course suicide, trampoline-purgatory escape.
- Scrap Shift: dual goal/movement watchdogs + a whole anti-quiet director.
- Small Guys: watchdog teleport re-seat; Horizon: replan@30s → respawn@60s; Web Slam: `letRally`; Hex Cascade: reshuffle-on-no-moves; Word Fall: idle sway + pit respawn.

Stalling is the #1 known watchability failure — and most rescue mechanisms are
**invisible teleports/warps that read as glitches on camera**. Evals assert max-stall
but (except blockmine-30m's `repaths===0`) never budget how often rescues fire.

## Finding 3 — Evals measure competence floors, not watchability

What's asserted today: finite state, progress floors, death/goal count bands, max-stall.
What's *not* asserted anywhere (except partially in Scrap Shift / Hex Cascade):

1. **Variety across seeds** — no eval compares runs to each other. Two seeds producing
   near-identical footage pass everything. (Only Block Mine's tower-blueprint test checks
   cross-seed difference, and only for the blueprint.)
2. **Imperfection actually firing** — Deadline Deck and Surfers' entire drama engine is
   `lapseChance`; a regression to 0 (robotically perfect play) passes every current band.
3. **Signature spectacle happening** — nothing asserts Horizon thunderjaw fights, Rocket
   demos within a match, Word Fall autonomous solves, Block Mine tower progress pacing.
4. **Pacing distribution** — totals are checked, spread is not. 40 kills in one clump +
   9 dead minutes passes the same band as 40 kills spread evenly. Scrap Shift's
   `maxDamageLull ≤ 8s` and Hex Cascade's pacing-curve test are the only exceptions —
   they should be the template.
5. **Both bounds** — several bands are floors only (Horizon downs has no minimum → a
   0-death safe plink-fest passes; Small Guys' star has a win floor but no dominance cap).

## Finding 4 — Creativity is bolted on in 3 games, absent in the rest

Existing mechanisms, best-first:
- Deadline Deck / Surfers: `skillProfile` lapses (human-like zoning out) — the right idea.
- Meat Lad: depth-scaled deliberate fumbles "for the fans".
- Scrap Shift: four true personas with distinct aggression/range/orbit.
- Small Guys: per-bean skill/bias + star clutch mode.
- Web Slam: probabilistic action gates.
- Block Mine, Hex Cascade, Horizon, Rocket, Word Fall: **uniform optimum-seeking, zero
  personality**. Their variety is 100% terrain/RNG; a bland seed yields a bland run and
  no eval catches it. Word Fall actively *cheats* (picks the known answer), destroying
  the Wordle tension it's built around.

---

# Recommendations

## A. Consolidate the bot layer (keep tactics game-owned)

1. **Standard telemetry probe.** Every game exposes `__probe()` returning a common core:
   `{frame, progressFrame, deaths, rescues, mode, events:[{t,type,tag}]}` — `mode` is the
   on-screen tactic label (most games already have one), `events` is an append-only log of
   watchable moments (kill, near-miss, build, breach, solve, lapse, rescue). Games extend
   freely. This one contract unlocks every generic eval below.
2. **Persona layer in autoplay.js.** `createPersona(rng, table)`: a named, seeded bundle
   of weights (risk, greed, patience, showboat, build-affinity) that games map onto their
   own tactic scores. Each attract run forks the RNG and draws a persona — run-to-run
   variety by construction. Scrap Shift's hand-tuned roles are the proof it works.
3. **Adopt `skillProfile` everywhere a body moves** (Block Mine, Horizon, Rocket, Small
   Guys non-star beans, Hex Cascade decision cadence). It's already battle-tested in two games.
4. **Standardize stall handling on `createProgressWatchdog`** with a shared escalation
   vocabulary (`nudge → replan → rescue`), each escalation logged as a `rescue` event so
   evals can budget them. Prefer *visible* recoveries (dig, rocket, panic animation) over
   teleports.
5. **Shared eval lib** (`evals/lib.js`): `check/near/band`, seeded run loops, JSON report
   output (generalize what blockmine-30m already writes), and a `bootGame`-based runner.
   Port blockmine-30m-eval off its hand-rolled `eval()` boot onto `harness.bootGame`.

## B. A generic watchability eval (one runner, original eleven games)

Compute from the standard event stream, per seed:

- **Lull**: max gap between interesting events. Band: ≤ 8–10s (Scrap Shift's bar).
- **Pacing shape**: events-per-minute curve should rise or oscillate, not flatline.
- **Behavior entropy**: n-gram entropy over the `mode` sequence. Catches "same stair-dig
  for 20 minutes" — a floor asserts the bot visibly changes what it's doing.
- **Cross-seed diversity**: run N seeds, compare mode/event signatures (Jaccard or edit
  distance); fail if any pair is too similar. This is the direct "differently every run" test.
- **Rescue budget**: `rescues ≤ k` (and rescue events must be > 20s apart). Warps and
  teleport re-seats stop being invisible.
- **Signature-moment floor**: each game declares 2–3 spectacle event types in `games.js`
  metadata; the eval asserts each occurs and is spread out.
- **Imperfection floor**: where a skill profile exists, assert `lapse`/`fumble` events > 0
  in drama runs (keep the existing `__NO_LAPSE` perfect-run tests as the competence anchor).

Run tiers: CI keeps today's 3 fixed seeds per game (fast, deterministic); a nightly sweep
runs 30–50 seeds and reports percentile distributions to JSON so thresholds can be set
from data instead of guesses, and drift is visible over time.

## C. Creative-but-fun: principled "not best path"

The mechanism that gives *creative* without *stupid*: **temperature over ranked plans,
plus a style bonus** —

1. Score candidate actions/plans as today (utility), add a `spectacle` term (air time,
   near-miss margin, combo potential, build flourish — game-defined).
2. Select by softmax over `utility + persona.showboat * spectacle` instead of argmax.
   Temperature is the creativity dial; personas set it per run. A showboat run takes the
   flashy line; a cautious run takes the safe one — both remain competent because utility
   still dominates catastrophic choices.
3. **Mood arcs**: drift skill/risk over a run (nervous open, confident middle, desperate
   finale) for narrative shape — trivially built on `skillProfile` parameters.
4. Watchability evals (B) are the guardrail: entropy/diversity floors force creativity to
   exist; competence bands and lull caps stop it from tanking the run.

## Implemented and proven (2026-07-09)

Each change below was measured against the pre-change bot on identical seeds before
being accepted; the proof is wired into the evals so it re-runs forever.

1. **Word Fall — real deduction + a Wordle layer that actually plays.** Baseline
   measurement revealed the audit undersold the problem: in attract mode the puzzle
   NEVER completed (0 solves over 24 seeds × 3 min) because every death wiped the
   puzzle, gem charge, and combat gate. Fix: attract deaths keep the half-solved word
   and altar economy (player sessions still start clean), and the oracle pick was
   replaced with `WordPuzzle.bestGuess` deduction over `possibleTargets()`. Proven:
   0 → 1.42 solves and 0.63 → 4.04 guesses per 3 min (24 seeds), 2.85 guesses/solve,
   combat bands intact. Eval now asserts solves ≥ 1, guesses ≥ 3, guesses > solves,
   plus persistence fixtures both ways.
2. **Deadline Deck + Surfers — imperfection is now guarded.** Lapse onsets are counted
   by wrapping `skillProfile.decide` in the eval footers. Measured 2/3/1 per 5-min
   deck run and 24/23 per 10-min surfers run; asserts fail if lapses stop firing
   (verified: disabling lapses trips the floor) or explode into a stumble-storm.
   Surfers' perfect-run test also asserts exactly 0 lapses under `__NO_LAPSE`.
3. **Hex Cascade — cascade-aware lookahead.** `simCascadeGain` resolves each candidate
   swap one clear+fall ahead on a private board copy (refills become unmatchable
   holes; zero RNG reads). Proven: +27% chain-clears (1422 → 1801 over 10 paired
   seeds), +13% specials, wins 10/10 seeds, all watchability bands intact. The eval's
   new section 8 permanently re-proves lookahead > greedy on a fixed seed via the
   `__NO_LOOKAHEAD` switch.
4. **Pocket League — ball-trajectory interception with human aim fuzz.** `predictBall`
   mirrors `ballStep` exactly (eval asserts 0.000px drift over 30 frames); cars drive
   to the ETA-scaled intercept. First attempt scored +42% goals and broke the ≤30
   band (the eval caught it); final design keeps the defender's read exact but fuzzes
   the attacker's aim proportionally to prediction distance — whiffs and re-approaches
   instead of robotic conversion. Proven: +20% goals (208 → 249 over 10 paired seeds,
   8/10 wins), every seed inside the 10..30 band, scrum time down, splits balanced.

5. **Ten-minute soaks on every game** (John's standing highest priority). New shared
   `evals/soak.js` samples a per-game `__soakProbe` every simulated second and
   asserts the three critical invariants: the world keeps MOVING (motion signature),
   things keep HAPPENING (cumulative activity events), and PROGRESS keeps being made
   (cumulative story marks) — plus finiteness. Added to the six games that lacked
   10-minute coverage (webslam, wordfall, hexcascade, rocket, deadline-deck,
   scrapshift) and to horizon (whose 10-minute run only checked totals, not gaps).
   All limits calibrated from two measured seeds per game, ~2× worst-case.
   Findings the soaks surfaced immediately:
   - **Word Fall: the rune-word story can go dark for ~174s** late in a run —
     `chargeNeed` grows to 42 gems per guess round. Known issue; current limit 240s
     locks it from getting worse. Fix candidates: cap chargeNeed in attract, or
     scale gem drops with floorNo.
   - **Pocket League can go 75s without a scoring beat** (limit 120s) — consider a
     director-style nudge if it drifts longer.
   - Horizon's Aloy legitimately holds a stealth hide for ~28s while machines prowl;
     the soak tracks world motion, not just the avatar.

Iteration lessons worth keeping: measure before believing (two of four "improvements"
initially failed their own bands or instruments); paired same-seed A/B via a
`__NO_<FEATURE>` switch is cheap and makes the proof permanent; watchability bands
are design contracts — when an improvement busts one, temper the bot (ideally with
human-flavored imperfection), don't widen the band.

## Environment acts + payoff ladders (2026-07-09, fusion-max council)

All original eleven games now run `E.createShow` (see AGENTS.md "Acts and the payoff
ladder"). Per-game acts, each proven by a warn-phase A/B divergence against
`__NO_ACTS` plus exact apex time budgets:

- **Scrap Shift** — press/sweep telegraphs on the existing phase ladder; wreck
  slow-mo + killer admire coast. **Rocket** — CROSSWIND bends ball and
  `predictBall` identically; defenders pre-position. **Hex Cascade** — volatile
  tide re-values chosen swaps (5/5 seeds); lord-fall hold+slow+admire.
- **Word Fall** — rune storm on a death-persistent clock; closed the 174s
  story-cadence gap (stall band tightened 240→120s). **Block Mine** — existing
  day/night/Babel acts; kernel adopted as telemetry+ladder only (30-minute
  no-stall contract; heldFrames pinned to 0). Later the same day the sky
  itself became an act: full sky rewrite (sun/moon arcs in the HUD-free band,
  hash-field stars, dawn/dusk palette, weather-driven cloud decks, rain) plus
  a rolling STORM FRONT — 240f telegraph then a 15s storm, hash-scheduled
  with zero RNG draws, deterministic lightning columns biased toward Babel
  (the crown absorbs bolts as a lightning rod; camp columns are spared so the
  tent is a true shelter). The surface bot breaks off grove/tower work at the
  first warn frame and waits it out at camp, stamping progressFrame so the
  30-minute no-stall contract holds. Proven: telegraph pairing via footer
  note collector (4 storms/10min, 240f each, ≥4 strikes per storm) and a
  forced-front tower-fixture A/B that must first diverge inside the warn
  window (diverges 7f in; the naive fixture time diverged 213f in because
  the shelter route and ore route shared the tower-spine ladder — pick A/B
  moments where the reaction is physically visible). 10-seed sweep: goals
  38.7 vs 39.8 baseline, deaths 0.0 vs 0.2, depth +11m, stalls unchanged.
- **Web Slam** — GALE act; wall-open slow-mo. **Deadline Deck** — ROADWORK lane
  closure; courier reroutes from the warning; FRONT PAGE hitstop.
  **Surfers** — EXPRESS wave surges live trains inside the corridor guarantee;
  perfect-run contract still holds (20km, 0 deaths).
- **Horizon** — herd migration; huntress covers up and rolls through
  stragglers; thunderjaw hold+slow+admire. **Small Guys** — round modifiers
  (FRENZY GEARS / HUNGRY SLIME / DOOR BLITZ) instead of a redundant timeline;
  bots adapt margins; crown hitstop. **Meat Lad** — ladder only per the
  council (rescue apex, NAILED IT clutch beats, booster saves).

Lessons this pass added: assert time budgets EXACTLY (a kernel off-by-one made
holds run 5 of 6 frames; exact asserts caught it); slow-mo skip frames must
stay inside the run branch (Surfers' fell through to the busted branch and
silently reset runs — the speed-curve band caught it); the kernel event log is
bounded, so long-window telegraph pairing needs a footer note collector
(Deadline Deck); pick A/B seeds so the pre-positioning situation actually
arises during the first warn window, and document the rejected seeds.

## Visual-gate rejection (2026-07-10)

Six simulations were removed from the active arcade after review: SKYHOOK YARD
(`skyhook` / BUILD AIRSHIP), APOGEE FOUNDRY (`apogee` / BUILD RING),
TIDELATCH (`tidelatch` / LIGHT CITY), PRESS RUN (`misregister`), CRESTCRASH
(`crestcrash` / TOPPLE RANGE), and DUNGEON EXPRESS (`dungeon-express`).

Their deterministic replays, behavior bands, same-seed policy A/Bs, and soak tests
could all be green while the rendered characters, environments, level identity,
and animation still fell below the MACHINE HUNT / BLOCK MINE release floor. None
had an executable real-pixel visual eval plus preserved native-size reference
comparison. Behavioral green is therefore not release approval; the historical
commits remain provenance, but these games and their old positive scorecard claims
are retired.

## From-scratch replacement: DUNGEON EXPRESS (2026-07-10)

**DUNGEON EXPRESS** is a clean-room Zelda dungeon × speedrun relay, not a
restoration of the retired implementation. A sword-and-boots courier now reads
compact authored dependencies under enemy pressure: arm either of two sigils to
open the runner-boots vault, repeat the two-order puzzle for the relay key, cut a
physical shortcut, defeat the always-telegraphed warden, and ring the altar across
three progressively faster laps. Route search remains private implementation;
the world, poses, tells, doors, fog, and consequences carry the viewer story.

- **Real puzzle state, both ways.** Fixtures solve both actual vaults left-first
  and right-first through the shipping activation function, record exactly two
  transitions and one completion, and prove planning consumes no engine RNG.
  Twenty-four seeded layouts remain connected with two branch rooms, seven
  shortcut positions, a nine-cell longest straight, and 17 distinct structural
  signatures. The boots, shortcut, key gate, warden, and altar form a visible
  dependency chain rather than collectibles at corridor ends.
- **Measured private route memory.** `__NO_ROUTE_MEMORY` restores a working
  cautious policy that rechecks rooms and never takes the remembered cut. On ten
  paired two-minute seeds, memory wins 10/10: 129 vs 111 laps, 40 vs 34 floors,
  and 121,931 vs 103,143 aggregate score. Every smart seed completes both sigil
  orders and physically crosses remembered cuts; its first exploratory split is
  2.70×..3.89× slower than the learned line. Repeatability and next-RNG equality
  keep the win causal without drawing a path.
- **Enemies force readable responses.** Slimes, bats, guards, and the warden own
  PATROL → TELL → CHARGE/INTERCEPT → RECOVER/STUN states. A controlled same-seed
  `__NO_ENEMY_AI` fixture first diverges one frame into the tell and produces a
  displaced hero response by frame 3; a blocked-lane fixture proves one visible
  brace, zero fake dodges, and zero movement. Across six active paired runs, the
  full enemy policy forces 37 received hits versus 81 under the still-progressing
  simple baseline, with real dodges, braces, counters, and near misses counted
  separately.
- **No waiting disguised as activity.** Three independent ten-minute soaks finish
  66..71 laps and 22..23 floors with 198..211 enemy tells, 195..209 player
  responses, 1,448..1,482 deduplicated events, 475..505 progress marks, only
  1s still, 2..3s quiet, 5..6s progress stalls, and 171..240 frames of tactical
  dead air. The shared actor-motion contract stays at or below 30 bare frames,
  45..55 emote frames, and about 4% emote share while retaining .099 cells/frame
  physical pace; local walking never resets the entertainment clock.
- **Shared control, acts, and exact show budgets.** Human and bot emit the same
  seven-field `{dx,dy,attack,dash,action,target,tactic}` intent through one
  `applyIntent` path. Each biome ward warns exactly 240 viewer/simulation frames,
  keeps the dungeon connected, and diverges physically during warning behind
  `__NO_ACTS`. Tiers remain strictly ordered with exact 6 hold / 24 slow / 48
  admire frames per apex; `__NO_ADMIRE` gates only the bot and `__NO_PAYOFF_FX`
  is a full-state same-seed no-op.
- **Authored-world and sequence proof.** Sunken Scriptorium, Ember Forge, Moon
  Ossuary, and Verdant Reliquary rebuild materials, landmarks, lighting, ambient
  motion, and act silhouettes. The native sequence proves room setup → first
  sigil → guard tell → displaced response → vault solve → changed aftermath,
  followed by all four floors and the apex. A contamination fixture mutates
  target, tactic, route, old-route, and trail buffers with an exact pixel no-op;
  the HUD reports local state, the mini-map reveals only discovered topology, and
  the warden is genuinely visible from a one-room-known spawn. All automated
  native gates pass beside MACHINE HUNT and BLOCK MINE; reviewed montage
  `7d2657ee…` and the inspected deterministic 30-second clip `dfb35c55…` are
  bound to the current renderer and source identity.

Permanent switches: `__NO_ROUTE_MEMORY`, `__NO_ENEMY_AI`, `__NO_ACTS`,
`__NO_ADMIRE`, `__NO_LAPSE`, `__NO_PAYOFF_FX`.

## From-scratch replacement and sky-raid redesign: WINGRUSH (2026-07-10)

**WINGRUSH** is the from-scratch momentum successor to the removed CRESTCRASH /
TOPPLE RANGE concept. Its current thesis is **ground is the battery; sky is the
arena**: Courier Finch reads a coin-marked hill route, dives to bank momentum,
converts the crest launch into lift energy and ram power, then steers vertically
through a visible approach to a floating fort. The behavioral receipts below are
executable in `wingrush-eval.js`; the native-size reference comparison and natural
autoplay sequence are executable in `wingrush-visual-eval.js`.

- **Momentum now funds sustained, controllable flight.** The deterministic bowl
  fixture still proves that diving the same valley materially beats coasting, but
  the payoff is no longer a one-shot ballistic arc. The earned-energy fixture
  measured 0.569 lift energy after the dive versus 0.368 after coasting. Over the
  same 120 airborne frames, powered climb moved -284.7px vertically, neutral glide
  moved +34.3px, and descent moved +304.2px; attempting to climb on empty energy
  ended +99.6px lower. Human and bot both emit the exact six-field
  `brace/coreId/dive/tactic/targetId/vertical` intent and pass through the same
  `advanceBody` physics. Terrain remains exact at all 121 sampled boundaries, with
  five biomes, at least eight hill families, and materially different relief.
- **Targets live in the sky and the route is legible before contact.** Five authored
  fort rigs sit 86px or more above their terrain and put every core at least 95px
  above ground. Wind rotors, balloons, kite sails, propellers/clouds, and the
  crystal crown give the structures distinct silhouettes; six-ring air approaches
  and deterministic ground-coin trails expose the intended line. A 960px bottom
  route ribbon previews terrain, coins, the selected fort, and the landing zone,
  while an edge marker preserves fort direction and distance offscreen and a
  world-space bracket calls the landing gate. Gust, spring, blast, and star
  fixtures now move a braced bird through `advanceBody` and `collideStructures`,
  and assert exactly one physical impact, target hit, and core trigger. Breaking
  the crown fort's foundations still cascades through every block until the full
  structure settles.
- **Natural autoplay hits what it visibly selects.** Across ten natural 60-second
  seeds `0x7900..0x7909`, every run made 7..10 direct fort hits, converted
  77.8%..90.9% of selected targets, and landed its first hit in 225..408 frames.
  The bot continually replans climb/glide/dive authority, locks exact aim inside
  the final 300px, and braces only for the physical strike; measured persona
  variation still leaves honest misses. The real-pixel suite independently finds
  the uninterrupted natural sequence for seed `0x7907`: target lock at frame 1,
  direct hit at frame 340, then a real forecast, commit, guided touchdown, and
  grounded follow-through. A missing touchdown is a hard failure, not a substituted
  recovery frame.
- **Lookahead earns destruction.** `__NO_LOOKAHEAD` restores the strengthened
  reactive glide on identical seeds. Across ten paired two-minute seeds, the
  planner won 8/10 and delivered 166 vs 125 direct hits, the same 166 vs 125
  toppled forts, and 319 vs 212 triggered cores. Launch eligibility is now
  identical on both sides, so the switch ablates policy rather than physics. The planner remains
  same-state pure, exactly repeatable, and consumes no engine RNG; the paired test
  also requires the reactive policy to remain active rather than becoming a weak
  straw-man ablation.
- **Target guidance is separately proven against the old feel-only behavior.**
  `__NO_TARGET_GUIDANCE` keeps the translated reactive dive/trim policy, narrow
  brace window, movement, air time, and world progress active. Across its ten
  paired two-minute seeds, guided targeting won 10/10 with 158 vs 25 direct hits
  and an 85.9% vs 13.8% conversion rate. This isolates the visible target lock and
  final approach from the independent lookahead proof instead of crediting one
  switch for the entire bot.
- **The landing marker is an operational contract.** A direct hit or passed fort
  moves the bot into recovery, where the displayed gate and the bot share the same
  tangent-aware landing controller. A 90px ground re-arm plus launch-clearance
  preview prevents touchdown/relaunch chatter. In ten paired natural minutes,
  guidance completed 81 of 86 attempts, cut rough landings from 71/73 to 21/83,
  preserved target hits at 82 vs 72, and produced zero natural micro-flights.
  `__NO_LANDING_GUIDANCE` keeps the unguided recovery active so the improvement is
  a fair same-seed A/B rather than an inert comparison.
- **The real pixels carry the redesign.** Courier Finch now has separate outlined
  torso and ivory head masses, a readable eye and beak, aviator cap, neck knot,
  short tail feathers, landing feet, and distinct climb/soar/descend/brace/impact
  silhouettes. The coral scarf is a six-node deterministic cloth chain driven by
  body velocity, wind, gravity, and flutter rather than an attached mermaid-tail
  shape. Rendered hide-layer masks hold the body to 20x20px, the whole actor and
  cloth to a compact 32px box, all five one-at-a-time fort rigs to 40x65px, and the
  combined actor/fort mask below 10% of the world crop. The actual fort, not merely
  its edge icon, occupies at least 55% of sampled airborne attack frames. The visual
  eval renders the actual 160x360 canvas and compares the current game beside
  MACHINE HUNT (`horizon`) and BLOCK MINE; retained old Topple Range snapshots are
  predecessor context, not a paired old-WINGRUSH baseline. It also gates the natural
  lock/approach/hit/recovery/forecast/commit/touchdown sequence, character animation,
  biome structure, hill silhouettes, route information, and native-size richness.
  Its semantic receipt separately grades character craft, environment, level
  variety, animation/impact, readability, and art-direction cohesion.
- **Long autoplay stays alive and destructive without cheating.** Independent
  ten-minute seeds `0x7810` and `0x7811` recorded 72/92 and 81/91 direct target
  hits, 86 and 87 landings, 96% and 98% guided attempts completed, about 21% rough
  landings, and only 1 and 0 micro-flights. Both retain measured coin,
  flight-control, event, progress, and miss bands; remain finite; make no invisible
  reset; and permit no unaccounted one-step position jump. Fixed-seed headless,
  chunked, and rendered runs are signature-identical across energy, targets,
  pickups, landing state, and the deterministic scarf. GUST and RAIN still warn
  for exactly 240 viewer and simulation frames and alter the flight during warning;
  shown payoff tiers remain strictly ordered, with exact 6 hold / 24 slow / 48
  admire frames per apex.

Permanent proof switches: `__NO_LOOKAHEAD` (paired planner ablation),
`__NO_TARGET_GUIDANCE` (translated old feel-only targeting),
`__NO_LANDING_GUIDANCE` (unguided recovery A/B), `__NO_ACTS` (warn-phase physical
A/B), `__NO_ADMIRE` (bot-only celebration pause), `__NO_LAPSE` (zero-lapse
competence anchor), and `__NO_PAYOFF_FX` (full-state same-seed no-op).

## Level-entertainment contract + Zelda-room repairs (2026-07-10)

Ghost Shift and Pico Cap exposed a hole in the prior quality gates: both could pass
determinism, ten-minute motion/progress soaks, competent-planner A/Bs, and rich-
pixel visual checks while still showing the viewer a computed path through an
obvious corridor. Correct navigation is not entertainment. `AGENTS.md` now makes
this a hard genre contract, mirrored in `CLAUDE.md`, and
`evals/entertainment.js` provides the reusable release assertion. It gives ordinary
steps, turns, junction crossings, and replans **zero credit**. A game must separately
prove authored topology, puzzle-state transitions, enemy actions, player responses,
multiple decision categories, a meaningful dead-air ceiling, and absence of a
rendered computed path. Its own negative fixture feeds the gate 900 movement events
and 60 replans; the corridor demo still fails on 17 independent grounds. The
shared assertion now rejects non-finite/permissive bands and requires each
decision category to declare a distinct telemetry source. The shared motion
assertion also rejects empty probes, mixed casts that hide rotating enemy IDs,
brief omission tricks, and sampling intervals too coarse to enforce the 30-frame
standing limit.

**GHOST SHIFT — ordered security chambers instead of a route-overlay maze.** Each
shift is now three authored rooms with a visible dependency chain: read the room,
press two numbered sigils in order to break the first seal, link twin power relays
to drop the second grid, raid the guarded inner vault, then extract. Different
blueprints move wall islands, gates, sight lines, and objectives across shifts.
Sentries independently patrol, chase, cut off the live objective, and enter a
visible stun state; the courier scans on room entry, counters a close sentry with a
limited phase pulse, then evades while it recharges. The computed route renderer
and ROUTE HUD are gone; source/render gates prevent their return.

- Two deterministic ten-minute seeds complete 44/42 shifts with 267/258 puzzle
  transitions and 705/633 physical pulse-or-evade responses. The presentation
  watcher separately records 126/110 near misses without relabeling them as
  player actions. Every inspected
  dependency cycle remains valid, the level keeps three rooms and a nine-tile
  longest open run, and the meaningful-beat clock tops out at 114/128 frames.
  Walking and turning do not reset that clock.
- `__NO_THREAT_PLAN` retains an active threat-blind courier. The tactical policy
  wins all six same-seed pairs on both score and survival, 4,258 vs 3,012
  aggregate, while cutting catches to 16..31 versus 91..97 for the blind runs.
- The shared actor-motion contract measures only physical courier/sentry travel,
  never the draw-only stun sway. Pulse/catch stuns are bounded to 55/60 frames;
  worst bare stillness is 30 frames, worst emote is 60, maximum emote share is
  14.5%, courier pace is 78.2..79.4px/s, and sentries retain 34.4..40.7px/s over
  a permanent ten-seed derivation.
- The native-pixel suite now shows rune setup → pressure → solved seal and relay
  setup → pressure → solved grid, plus the sentry pulse response, structural later
  shifts, lockdown, and extraction beside Machine Hunt and Block Mine. An explicit
  contamination gate proves puzzle fixtures contain no pulse cue/art; only the
  pulse fixture owns that effect. A second exact-pixel gate mutates private future
  waypoints and proves they have no render consumer. Drawn extents are 16×20 for
  the courier and 18×19 for a drone; the full watched cast occupies 7.2% of the
  playfield. Final montage SHA:
  `20a5743c67b9a23b6631f2b08dcd2dbc3cbaf56544f4bdd2bc249ee078571796`.

**PICO CAP — crack-or-briar puzzle rooms with charging wardens.** The procedural
corridor maze is now three compact authored chambers. Each room presents two
legible solutions to one sun key: shrink through the blue crack or stay big, cut
the red briar, and confront the guard. One key opens gate I, two open gate II,
three wake the shrine. Four biome layouts rearrange cover and charge lanes while
preserving the dependency proof. Gnawers guard and press, align a broad attack
lane, wind up, charge, crash, and recover; pico form sidesteps the tell while big
form can stand and parry. A 24-frame READ ROOM beat exposes the choice through
world props and posture, never a path line.

- The exhaustive state fixture proves all four layouts are distinct and solvable
  through both size states, with three rooms, six crack/briar solutions, and the
  1 → 2 gate dependency. Ten-minute seeds restored 34/31 glades, collected 104/93
  keys, saw 90/91 charges, answered with 37/46 dodges and 69/46 parries, held the
  longest straight traversal to 6/7 tiles, and never traveled more than eight
  tile steps without a tactical decision.
- The shared entertainment receipt aggregates 132 puzzle transitions, 65 full
  completions, 181 enemy actions, and 198 player responses. Its independent
  decision categories are all live (puzzle 970, threat 903, response 110, combat
  236, payoff 459). The active longest-route `__NO_SIZE_PLAN` baseline still
  solves rooms; the tactical policy won 6/6 pairs, 6,195 vs 3,311 aggregate with
  no baseline-only hesitation. Ordinary sidesteps no longer receive fake FEINT
  decision credit.
- Physical-only motion tracks the hero plus five stable live gnawer roles. Across
  the two permanent ten-minute seeds, worst bare stillness is 30 frames, worst
  emote is 60, hero emote share is 12.2/14.1%, watched movement occupies
  80.7/79.8% of samples, and physical pace is .771/.737px per frame.
- The real-pixel sequence is two-route setup → charge tell → pico dodge → big
  parry → sun-gate payoff → later biomes/storm/restore. Source checks reject a
  path renderer, dashed breadcrumb, or path probe. Dodge and parry fixtures each
  own exactly one causal effect, and fixture actors are frozen against unrelated
  combat so environment frames cannot borrow a hit flash. Isolated hunt animation,
  silhouettes, and the sword payoff all clear their original measured bands. An
  exact-pixel contamination fixture also proves future planner waypoints remain
  private.
  Final montage SHA:
  `38f949224e226e6d2ed9bd3de4019fd4154561deaa6879ea666d48e2140bfd86`.

**TOWER PANIC — private forecast, visible rescue drama.** The hazard-aware planner
still chooses safe gantries internally, but its dashed route, abandoned-route
echo, next-junction reticle, `VISIBLE PLAN` panel, and public route/hash probes are
gone. The viewer reads the authored tower itself: worker locations and helmet
roles establish the rescue priority, barrels/fire/pistons publish danger, the
purge column warns 240 frames before landing, and the HUD names the current
rescue or threat without exposing future waypoints. The rigger now physically
boards and rides the extraction cage instead of waiting through the payoff.

- Two ten-minute seeds prove six decks, at least nine branch nodes, and a longest
  straight of six. Their combined natural receipt records 118 objective-state
  changes, 29 completed evacuations, 366 enemy actions, and 231 physical brace
  responses; distinct decision sources report 118 puzzle, 366 threat, 231
  response, and 29 payoff beats. Walking and replanning receive zero credit, and
  the tactical dead-air ceiling is 252 frames.
- The existing forecast-versus-shortest-path causal A/B remains active and the
  complete Tower behavior suite passes. Shared motion sampling at five-frame
  intervals keeps a persistent `hero` ID: worst bare stillness is 20 frames,
  worst authored emote is 65/85 frames, motion occupies 94.1/94.4% of samples,
  and physical pace is .713/.719px per frame.
- The native visual suite source-bans every planner presentation surface and
  mutates the private future route tail in a frozen fixture; clean and
  contaminated renders are byte-identical. The reviewed sequence now shows
  rescue priority, ladder travel, cascading hazards, purge response, worker join,
  later-tower composition, and physical extraction with no route overlay. Final
  montage SHA:
  `ee03ffe5152a988284fcf16fcbd48141bf54758ee46ba26cb64350dfae78c93b`.

**Cross-platform visual receipt proof.** Native canvas PNG bytes differ between
macOS and Linux even when source, fixtures, and every executable pixel metric are
identical. `visual-harness.js` therefore still requires the exact reviewed montage
on the reviewer platform, but permits another OS only when the game, MACHINE HUNT
and BLOCK MINE reference sources, visual eval, capture harness, fonts, committed
visual baselines, offline renderer, runtime, and render dependency lock are
byte-exact. The local pixel/scale/detail/motion/reference gates always run.
`visual-receipt-eval.js` proves a changed reviewer-platform montage fails, an
exact-identity Linux raster is accepted, and stale identity, malformed hashes,
missing permission, missing suite/review registration, and non-finite bands fail.
All 15 identity inputs are individually mutation-tested. All 17 visual suites now
have one semantic JSON and one preserved reviewed PNG; ordinary evals write only
ignored artifacts and verify, rather than overwrite, those approved bytes. The
central registry also requires an exact suite/review/preserved-PNG game set, so a
deleted receipt fails. The explicit `preserve-visual-review.js` command is the
only acceptance path; it locates each suite's generated artifact by the approved
hash, including nonstandard and parent artifact layouts. The
renderer gate now runs two same-seed ffmpeg encodes, requires byte identity, and
uses ffprobe to assert H.264, 320×720, six frames, and 30fps instead of treating
`--help` as an encode test. A clean Linux x64 Node 24 container passes the global
receipt audit plus Ghost Shift, Pico Cap, Dungeon Express, WINGRUSH, Star Salvage,
Frog Convoy, and Swarm Keeper visual suites. Swarm Keeper exercises the intended
portable case: Linux pixels differ, while the source identity and preserved
Darwin review remain exact. The final macOS gate passes all 56 suites (39
behavioral and 17 visual).

## Genre-fusion addition: MOTO BOWL (2026-07-10)

**MOTO BOWL** crosses Tecmo Bowl with Excitebike: downs, play calling, and
coordinator reads give the drama its grammar; throttle heat, ramps, whoops,
mud, and oil give every snap its physics. One rusher (with two escort
blockers) runs a 15-minute title match against a **wave defense** — the field
is arranged Excitebike-style as spaced threat waves down the track (front
line at 9-13 yards, second level 16-20, deep shell 26-44). Asleep waves hold
their depth and visibly mirror the rusher's lane; they break into pursuit
only when the run closes on them, so every snap opens with a real approach
the viewer can read. Chains sit at 15 yards to match the geometry. Near the
goal the whole structure squeezes proportionally into the remaining field
(floor 0.55) and shell defenders who no longer fit in front of the plane are
not fielded — goal-line stands are a dense box, not a wall — and the plane
scores first: a rusher crossing the goal is untouchable even if a defender
reaches him the same frame. The rival's off-screen offense scores on a fixed
broadcast schedule and the match ends, win or lose, exactly at run frame
54,000. The end zone is the end of the world — ten yards of TITLE paint, the
back line, and the uprights; nothing spawns or rides past it.

Core contracts, all in `motobowl-eval.js`:

- **One physics path.** Human, bot, and every planner rollout pass through the
  same `advanceBike`; the planner fixture proves purity, repeatability, exact
  replay (error 0), and zero engine-RNG consumption.
- **Level gen is proven, not vibed.** Each drive's ramps/mud/whoops/oil come
  from sim RNG through `AI.generateValidated`, with a corridor validator over
  every 25-yard window; the eval generates 100 drives (100/100 valid, 23
  distinct layout shapes).
- **Wave defense** (`__NO_WAVES` restores the legacy converge-at-the-snap
  swarm): the aggravation metric is point-blank first contact — a defender
  reaching the rusher inside 4 yards of the snap. Waves 6.1% vs swarm 19.3%
  mean over six paired ten-minute seeds (6/6 wins) while keeping the drama
  balance (65 TDs / 30 turnovers across the six runs). A keyed play fires
  the front wave off the ball at the snap, so the coordinator's read is
  visible as behavior; a dodged read prints CAUGHT 'EM LEANING. The camera
  leads the run (presentation-only) and the huddle draws the called play as
  a gold ghost route on the grass.
- **Field goals.** On 4th and long inside nineteen yards the tee ramp comes
  out: the kicking unit lines up on a groomed strip (rolling start, mud and
  oil cleared) and launches through uprights standing on the goal line —
  good if it clears the bar between the posts, wide or short if not, blocked
  if the rush gets home first, and a grounded crossing is six (the fake).
  The deterministic fixture proves an isolated kick lands exactly three;
  the calibration measures 0..4 attempts per ten minutes with roughly six of
  ten landing.
- **Boost pads and the fullback.** Two or three boost pads per drive give a
  free heat-less speed burst the lane planner detours for on its own (it
  rolls the exact integrator, so pads simply score better); ramps carry
  pulsing up-chevrons so airborne intent telegraphs. A third blocker — the
  lead fullback — answers the third-pursuer cleanup tackle, paid for with a
  hotter front seven (line 1.07, backers 1.26) so blocks win moments, not
  the whole field.
- **Copied-state lane planning** (`__NO_LANE_PLAN` restores widest-gap
  reactive running): candidate lanes x turbo policies roll the exact
  integrator and the exact defender pursuit 90 frames ahead. Won yards per
  play 10/10 paired five-minute seeds, 12.37 vs 9.11 (+3.26), touchdowns
  43 vs 19 (+126%).
- **Tendency-mixed play calling** (`__NO_PLAY_MIX` restores argmax): the
  defensive coordinator keys the offense's most frequent recent call (pure
  history math, no RNG); the bot charts its own tendencies and dodges the
  read unless the best play is a blowout. Keyed-play rate 18.5% vs 55.0%
  (-36.5pp), 8/8 paired seeds.
- **Acts.** STORM FRONT (240f warning, wet grip, slower turbo ceiling) and
  BLITZ PACKAGE (210f warning, stacked fronts on every huddle while live).
  Both prove first physical divergence against `__NO_ACTS` inside the warn
  phase — CUT TURBO at +60f, SPREAD WIDE at +180f — via a physical-only
  motion probe (act phases deliberately excluded so the clock itself can't
  fake a divergence). Session reset during a warning cancels cleanly.
- **Honest imperfection.** Three personas (DIESEL power runner, GHOST juker,
  BIG AIR showboat whose planner is paid extra for ramp lines), slot-based
  lapses (`__NO_LAPSE`), hash-based aim fuzz, and a REDLINE behavior whose
  per-play deterministic gut call sometimes pushes the heat gauge past the
  stall point — overheats are drama the governor would otherwise never allow.
- **Show ladder.** Tier 1 launches/landings/blocks/tackles, tier 2 first
  downs/breakaways/4th-down conversions/act resolutions, tier 3 touchdowns
  and the title, with exact 6 hold / 24 slow / 48 admire frames per apex and
  `__NO_ADMIRE` gating the celebration intent. `__NO_PAYOFF_FX` is a proven
  same-seed sim no-op.
- **Viewer story** (`__NO_VIEWER_STORY`, sim-exact, RNG-untouched): persistent
  `HOME x · AWAY y` scoreboard, down-and-distance line, plain verbs (FIND THE
  GAP, REDLINE THE ENGINE, BEAT THE BLITZ), TV-style gold chains line on the
  field, and a truthful drive forecast (SHORT OF CHAINS / CHAINS AHEAD / TO
  THE HOUSE) recomputed from the live plan's own integrator projection — the
  eval re-derives every sampled label from simulation truth.

Thirty fixed ten-minute seeds (0xd000 + i*233), re-calibrated after the
field-goal / boost-pad / third-blocker batch, were all finite: 135..151
plays, 8..17 TDs, 42..54 first downs, 118..142 tackles, 2..30 broken
tackles, 1..21 hurdles, 80..128 jukes, 270..301 blocks, 11..33 ramp
launches, 0..4 overheats, 5..16 tumbles, 1..8 turnovers, 10..27 keyed
plays, 2..11 boost hits, 0..4 field-goal attempts, 833..935 events,
181..199 progress marks; worst story lull 762f and a constant 262f
visible-event lull. A 20-seed 15-minute panel scored 94..171; the rival
schedule is pinned at 101 (the panel's 10th percentile — fourteen
off-screen touchdowns plus one rival field goal), giving 17/20 titles won,
many by a score or two, with the three flattest runs losing. Football's own
rules are the anti-stall layer: the play clock, the forward-progress
whistle, and turnover on downs bound every possible wedge, and the shipping
soak stays within its still/quiet/stall budgets over ten minutes with zero
rescues of any kind.

Deliberate cuts, recorded rather than hidden: no passing game, no punts (a
4th down out of kicking range is always a go), no player-controlled
defensive possessions, and the rival plays entirely off-screen on a
deterministic schedule. Permanent switches: `__NO_WAVES`, `__NO_LANE_PLAN`,
`__NO_PLAY_MIX`, `__NO_ACTS`, `__NO_ADMIRE`, `__NO_LAPSE`, `__NO_PAYOFF_FX`,
`__NO_VIEWER_STORY`.

## Genre-fusion addition: STAR SALVAGE (2026-07-10)

**STAR SALVAGE** crosses Asteroids with Katamari: the tug cuts authored,
faceted asteroids into material-specific scrap, tethers the pieces into one
physical train, and has to bring that increasingly ridiculous load through a
narrow refinery bay. Every extra piece raises value and chain bonus while
reducing turn/thrust authority, increasing cable stress, and lengthening the
spring train. Cargo can visibly snap free or be deliberately dropped; there
is no invisible rescue of the load and the bot carries cargo through act
warnings instead of deleting the dilemma.

- **Copied-state greed planning** (`__NO_GREED_PLAN` restores the measured
  fixed-three-piece return policy) rolls candidate detours and the route home
  through the exact ship integrator. It judges value, mass, projected danger,
  cable stress, and arrival time, and physically reels toward a swinging tail
  when the chain needs slack. The reel now yields to the emergency-home branch
  above 1.9 cable stress; MARA can make an earlier controlled tail cut while
  JAX/SOL hold the bank order. The shared 28% chain step pays every controller,
  but only the planner's visible four-to-six-piece trains compound it beyond the
  baseline's single three-piece step. Across the permanent ten-seed ten-minute
  A/B, native macOS wins 10/10 at 5,918 vs 4,418 aggregate (+34.0%); the exact
  Linux x64 Node 24 environment wins 9/10 at 5,696 vs 4,671 (+21.9%). The 20%
  aggregate floor and all policy bands remain unchanged. The reactive flank now
  normalizes the exact antipodal +π/-π branch cut to the same side before steering;
  `__NO_PORTABLE_FLANK` restores and the pure fixture exposes the old split. This
  removes the libm-dependent fork that the first Linux CI run exposed.
- **Human-flavored control.** Three salvager personas change precision, risk,
  and greed; `AI.skillProfile` supplies reaction delay and short hesitation
  lapses behind `__NO_LAPSE`. Human and bot emit the same game-owned intent
  object through `AI.controllerMux`, and every intent reaches one
  `applyIntent`/physics path.
- **Acts.** A magnetic squall telegraphs for 240 frames and a meteor front for
  210. With cargo attached, the tug visibly turns for home during the warning;
  without cargo, it takes shelter. Paired same-seed fixtures first diverge
  physically during warning (frames 80 and 78), before either act lands, and
  reset cancels pending land events. `__NO_ACTS` remains the permanent
  ablation.
- **Homecoming show.** The refinery catches each fragment sequentially with
  animated clamp beams; dockhands raise their arms; a bay-wide pulse expands
  on milestone hauls; the Star Ark permanently changes construction at 80,
  180, and 260 value, then launches at the exact 15-minute ending. Tier order
  is strict, and tier-three cues consume exactly 6 hold / 24 slow / 48 admire
  frames. `__NO_ADMIRE` gates only the bot pause and `__NO_PAYOFF_FX` is a
  perfect same-seed simulation no-op.
- **Watchability calibration.** A fresh 30-seed native macOS ten-minute sweep measures
  364..856 banked value, 62..117 pieces, 100..315 bonus, 20..42 homecomings,
  5..6 maximum train, 1..9 deliberate drops, 14..44 snaps, and 17..55 lost
  cargo. Event/progress lulls are 701..721 and 1,002..1,964 frames. The economy-
  sensitive ceilings were explicitly re-derived from that distribution with
  margin: value 900, bonus 350, trips 46, overload homes 9, snaps 52, lost cargo
  65, and events 390. The bonus floor tightens from 70 to 80; every other band,
  including the 0..10 deliberate-drop ceiling, stays unchanged. Those are
  measurement-driven boundaries, not a relaxation of the unchanged 20% A/B or
  soak/story-lull contracts.
  The independent Linux Node 24 panel (`0x5c000`, `0x5c65f`, `0x5ce90`,
  `0x5da65`) banks 634..693 value and 92..97 pieces in 25..32 homecomings;
  maximum train is 5..6, snaps 22..26, and lost cargo 27..33. Its shared soak
  records one still second, an 11-second quiet run, a 26-second progress stall,
  298 events, and 175 progress marks.
- **Authored world and visual proof.** Planet-limb, orbital-ring, and ship-
  graveyard sectors change composition as the Ark grows. The wedge tug has
  articulated booms, cockpit/pilot, recoil, thrust, damage, and strain poses;
  material language, layered depth, warning fronts, train cables, the built
  refinery, and the staged Ark remain legible at 160x360. The discovered
  real-pixel visual eval captures opening, normal, overloaded, later, danger,
  and apex fixtures beside MACHINE HUNT and BLOCK MINE and requires a fresh
  hash-bound six-category review receipt.

Permanent switches: `__NO_GREED_PLAN`, `__NO_ACTS`, `__NO_ADMIRE`,
`__NO_LAPSE`, `__NO_PAYOFF_FX`.

## Historical PICO CAP baseline (superseded 2026-07-10)

The original five-shard corridor/Dijkstra registration is retired. Its green
competence and soak numbers did not prove entertainment, and its route-following
presentation is the failure case that motivated the shared level-entertainment
contract. The current three-room crack-or-briar design, enemy agency, causal A/B,
dead-air ceiling, and native visual sequence are registered under
“Level-entertainment contract + Zelda-room repairs” above; old bands and montage
claims do not describe the shipping game.

## Genre-fusion addition: ROBO RALLY (2026-07-10)

**ROBO RALLY** crosses Mario Kart with programmable robots. Four tiny racers
publish five real registers in a broadcast deck, project the same queues onto
the course, then execute together through conveyors, crushers, oil, pits,
turrets, weapons, and one another. The reveal is the drama engine: a viewer can
call the collision before the cards lock, while skill-profile misreads preserve
occasional disastrous fifth instructions.

- **Copied-state pileup forecast** (`__NO_FORECAST` restores the measured
  hazard-blind program release) scores a fixed library of five-card programs
  against board geometry, future crusher timing, telegraphed acts, and the
  other three published queues. It is pure, repeatable, and consumes no engine
  RNG. Across eight permanent paired five-minute seeds it won 8/8: aggregate
  score 26,492 vs 6,281 and 249 vs 62 flags, while both policies remained in
  the same collision, wipeout, lapse, act, event, and progress bands. Register
  and conveyor outcomes are snapshot-resolved and invariant to racer-array
  order; a robot struck in a register still completes its already locked card.
- **One simultaneous physics path.** Human and bot controllers emit the same
  nine-field register intent through `AI.controllerMux`; `applyIntent` handles
  every turn, move, brake, and shot before collision arbitration. Four
  independently seeded `AI.skillProfile` instances provide reaction delay and
  short visible program misreads behind `__NO_LAPSE`. The four personas are
  authored silhouettes rather than color swaps: BRASS boiler, NOVA comet,
  PATCH salvage bot, and VEX spider chassis.
- **Acts and show discipline.** CRUSHER RUSH and POLARITY FLIP begin only at a
  program reveal, so the warning changes a real published queue and applied
  register before it lands. Paired fixtures first diverge at 231f and 183f of
  their exact 240f warnings. Tier 1 collisions/hazards, tier 2 gates/pileups,
  and tier 3 course unlocks stay strictly ordered; each apex consumes exactly
  6 hold / 24 slow / 48 admire frames. `__NO_ADMIRE` gates only the pause and
  `__NO_PAYOFF_FX` is byte-identical simulation.
- **Measured watchability.** Twenty fixed ten-minute seeds
  (`0xa100 + i*137`) produced 56..64 flags, 7..8 course changes, 21..59
  collision participants, 1..11 physical three-bot pileups, 7..23 wipeouts,
  2..10 crusher hits, 4..25 oil spins, 8..18 final-card disasters, 20..42
  lapses, 1,068..1,181 events, and 700..782 progress marks. Shipping soaks
  stayed finite with zero invisible rescues, at most 5s still, 3s quiet, and
  6s without progress.
- **Authored visual proof.** Ember Foundry, Acid Refinery, and Orbit Skydock
  rebuild side architecture, landmarks, material grammar, hazards, and negative
  space. The real-pixel gate isolates every racer and placed structure: drawn
  racers measure 16..19 by 16..20px, crushers 16 by 19..20px, sampled combined
  footprint is 3.8..6.6%, and the visible approach runway is 72.7%. It also
  verifies aligned locomotion, program-deck state, a 0.380 course-structure
  delta, warning/pileup/final-card/apex frames, a native MACHINE HUNT / BLOCK
  MINE contact sheet, a rendered clip receipt, and a hash-bound six-category
  semantic review.

Permanent switches: `__NO_FORECAST`, `__NO_ACTS`, `__NO_ADMIRE`,
`__NO_LAPSE`, `__NO_PAYOFF_FX`.

## Disaster-triage addition: KAIJU CONTROL (2026-07-10)

**KAIJU CONTROL** tells a rampage from the city's side. A tiny emergency rig
publishes its evacuation, repair, grid-bracing, and decoy route while one
sanctioned set-piece kaiju publishes a separate impact path. Civilians and
critical buildings remain small; the persistent city state is the scorecard as
windows darken, rubble and smoke accumulate, and repaired neighborhoods relight.

- **Forecast triage wins without killing the drama.** `__NO_TRIAGE_PLAN`
  restores an honest nearest-urgent-task policy that can evacuate, repair, and
  deploy a late decoy but cannot compare response time with kaiju impact time or
  react to an act warning. Across twelve paired ten-minute seeds the forecast
  policy won 12/12: aggregate triage score 10,564 vs 9,085 (+16.3%), 864 vs 809
  civilians evacuated, and zero vs 55 casualties. The baseline remained fully
  active (18..26 attacks, 10..13 decoy hits, 27..34 repairs), so the panel does
  not compare against a crippled bot.
- **Human-flavored emergency command.** Guardian, Engineer, and Trickster
  personas reweight the same pure task model; a private `AI.skillProfile` RNG
  adds reaction delay and visible route-recheck lapses behind `__NO_LAPSE`.
  Human and bot emit the same six-field intent through `AI.controllerMux` and
  one `applyIntent`/graph-motion path. Planner purity, repeatability, engine-RNG
  non-consumption, replay/render parity, and payoff-FX simulation no-op are
  executable fixtures.
- **Acts change the plan before impact.** Surge, aftershock, and blackout fronts
  warn for exactly 240 viewer frames. CIVIC-1 physically reroutes on the first
  warning frame to brace the grid or, on a deterministic honest misread, clear
  the evacuation underpass. `__NO_ACTS` removes both notes and that route change.
  Tier order is strict and every district apex consumes exactly 6 hold / 24 slow
  / 48 admire frames; `__NO_ADMIRE` gates only the bot pause.
- **Measured watchability.** Thirty fixed ten-minute seeds
  (`0x6c000 + i*137`) all evacuated 72 civilians and saved five completed
  districts, with 3..11 kaiju attacks, 21..27 successful diversions, 3..15
  repairs, 4..6 act saves, 1..9 lapses, 111..124 events, and 101..109 progress
  marks. All runs were finite with zero invisible rescues, building losses, or
  casualties; the shipping soaks stayed within 2s still, 16s quiet, and 17s
  without story progress.
- **Authored city and scale proof.** Tideward Harbor uses warehouses, tidewall,
  piers, and a crane; Lantern Row opens around tram rails and a clock plaza;
  Crown Grid rebuilds around glass parcels, an atrium, and monorail. Real-pixel
  isolation measures CIVIC-1 at 16x17px, the kaiju at 32x31px, every civic
  structure at or below 24x24px, sampled combined footprint at about 10.3%, and
  visible kaiju runway at 80.4%. The hash-bound native montage compares ten
  semantic beats against MACHINE HUNT and BLOCK MINE, and a final 60-second
  rendered clip preserves the inspected result.

Permanent switches: `__NO_TRIAGE_PLAN`, `__NO_ACTS`, `__NO_ADMIRE`,
`__NO_LAPSE`, `__NO_PAYOFF_FX`.

## Genre-fusion addition: MOONSHINE VALLEY (2026-07-10)

**MOONSHINE VALLEY** crosses a tiny authored farm with nighttime survival
automation: the bot plants, waters, harvests, ships, builds moonlamps, then
defends the same visible rows through dusk and dawn.

- **Predictive night planning.** `forecastThreat` ranks creatures by crop
  urgency and leads their current velocity without mutating simulation state
  or consuming engine RNG. Against `__NO_NIGHT_PLAN`'s late reactive defense,
  it won all ten paired ten-minute seeds. The combined farm score
  (`objectives*20 + shipped + kills*3 + perfectNights*4 + lastSecondSaves*2 -
  cropLosses*10 - breaches*12`) totaled **6,958 vs 6,071 (+14.6%)**; smart
  defense made 720 kills versus 436 while both policies stayed inside measured
  watchability bands.
- **Day/night is the act.** The existing cycle telegraphs dusk for exactly 240
  frames before creatures land. The forced same-seed `__NO_ACTS` fixture first
  diverges in numeric farmer motion on the first warning frame as the bot
  abandons daytime work to secure the farm. Warning/land notes pair exactly,
  and resetting during dusk produces zero stale night landings.
- **Show discipline.** A ten-minute run offered tiers **916 > 84 > 10** and
  showed **739 > 80 > 10**. Ten dawn apexes consumed exactly **60 hold / 240
  slow / 480 admire frames** — 6/24/48 each. `__NO_ADMIRE` removes only the
  sunrise pause, while `__NO_PAYOFF_FX` remains signature-identical after 117
  harvests, 37 kills, and five dawns.
- **Measured watchability.** Across the ten smart-policy seeds, objectives were
  10/10, shipped harvests 231..246, kills 68..75, crop hits 0..3, crop losses
  0..1, perfect nights 9..10, events 1,591..1,676, and progress marks 627..665.
  Normal skill profiles produced 38 visible lapse onsets across the panel;
  `__NO_LAPSE` produced exactly zero while still completing all ten objectives
  with 191 shipments, 80 kills, and ten perfect nights.
- **Ten-minute soak.** The shared soak stayed finite with **0s still, 5s quiet,
  10s without progress, 1,605 events, and 636 progress marks**. Same-seed
  headless, chunked, and rendered runs are signature-identical; human and bot
  use the same seven-field intent through one `applyIntent` path.
- **Authored visual proof.** The hash-bound real-pixel and native semantic gates
  pass against MACHINE HUNT and BLOCK MINE. Drawn actors measure farmer
  **16×20**, crops **4..17×5..17**, creatures **13..19×14..17**, and moonlamps
  **12..16×23**; normal actor footprint is **4.16%..7.49%**, and threats retain
  **56.3%** approach visibility. Spring crossings, summer terraces, autumn
  orchard court, and frost greenhouse compositions differ structurally by
  **0.311..0.410**, with aligned animation peaks of .446 farmer, .075 crop,
  .371 creature, and .055 moonlamp. The preserved contact sheet, 65-second
  motion receipt, and six-category review are bound to the accepted game hash.

Permanent switches: `__NO_NIGHT_PLAN`, `__NO_ACTS`, `__NO_ADMIRE`,
`__NO_LAPSE`, `__NO_PAYOFF_FX`.

## D. Per-game priorities

1. **Hex Cascade** (2/5): add 2-ply cascade awareness via `simulateCandidates` (its board
   already has a pure step function — cheapest big win), plus temperature selection.
2. **Pocket League** (2/5): port Web Slam's `predictBallX` idea — ball-trajectory
   interception + a possession/blowout eval band.
3. **Word Fall**: replace the omniscient altar pick with `WordPuzzle.bestGuess` (the
   entropy solver already exists in-repo and is unused by the game!) — authentic deduction,
   occasional wrong guess, real drama. Assert `solves ≥ 1` in autonomous runs.
4. **Block Mine**: persona layer (architect/speedrunner/hoarder) — the biggest game with
   zero personality; add mode-entropy + cross-seed diversity to the 30m eval.
5. **Deadline Deck / Surfers**: assert lapses fire; done.
6. **Horizon**: lower bound on downs (or a "danger time" floor), count watchdog firings,
   thunderjaw encounter floor.
7. **Meat Lad**: budget warps/rockets per 10 minutes so late-game rescue-spam can't
   masquerade as skill.
