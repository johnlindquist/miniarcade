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

## From-scratch replacement: WINGRUSH (2026-07-10)

**WINGRUSH** is the from-scratch momentum successor to the removed CRESTCRASH /
TOPPLE RANGE concept. The frozen behavioral registration is game SHA-256
`16aacc661098304c5cb2c5c24b022a3d1bde425a4af9f48dbcb22ff42c2acc14`;
all receipts below are executable in `wingrush-eval.js`. This is behavioral and
simulation proof only — visual release approval remains the separate real-pixel,
native-size reference gate required above.

- **Tiny-Wings momentum is physical, not copy.** The deterministic bowl fixture
  compares the same bird on the same hill. Holding the dive banked speed
  4.53 vs 3.87 and charge 1.21 vs 0.25; opening at the exit crest produced a
  579px flight, 124px apex rise, and 152 airborne frames, over 300px and 100
  frames beyond the coast policy. Terrain hits all 121 sampled segment boundaries
  exactly, with a sub-.001px numerical seam; five biomes expose nine named hill
  families and five distinct family palettes, with measured relief 94.3..133.0px.
- **Lookahead earns destruction.** `__NO_LOOKAHEAD` restores the reactive
  feel-only release. Across ten paired two-minute seeds, lookahead won the
  destructive score on 8/10 and delivered 154 vs 92 broken blocks, 24 vs 16
  toppled towers, and 41 vs 25 cores (aggregate score 558 vs 352, where a block
  is 1, a tower 10, and a core 4). Both policies remain inside the same measured
  launch, flight, impact, failure, progress, and pacing bands. The planner is
  same-state pure, exactly repeatable, and consumes no engine RNG.
- **Power-ups alter momentum and architecture.** Isolated runtime fixtures prove
  the gust core raises forward speed to 5.26 with a 240f boost, the spring launches
  at 5.67 with a 300f boost, the star cage yields the 480f momentum/combo power-up,
  and the blast heart breaks eight nearby blocks. Breaking the three foundations
  of the 12-block crown keep propagates through the support graph until all twelve
  blocks fall, settle, and register exactly one toppled tower.
- **Acts and show timing are exact.** GUST and RAIN each warn for exactly 240
  viewer and simulation frames; paired `__NO_ACTS` runs first diverge physically
  on warning frame 1, before the act lands. The ten-minute runs emitted reproducible
  warning/land pairs (allowing only the final still-live warning at the sample
  boundary). Tier frequencies were strictly ordered: shown tiers 106/65/5 and
  110/61/8. Apex budgets were exact at 6 hold / 24 slow / 48 admire frames each
  (30/120/240 and 48/192/384 totals), with `__NO_ADMIRE` gating the bot pause.
- **Long autoplay stays alive without cheating.** Two independent ten-minute
  soaks had 0s still time, 8..9s maximum quiet and progress gaps, 491..616 visible
  events, 256..280 progress marks, 51..61 great flights, 8..11 toppled towers,
  and 14..16 cores. Both stayed finite, made no invisible reset, and had no
  unaccounted one-step position discontinuity. Human dive/trim/brace uses the same
  six-field intent schema and `advanceBody` physics path as the bot. Fixed-seed
  headless, chunked, and rendered runs are signature-identical, and
  `__NO_PAYOFF_FX` is a proven simulation no-op.

Permanent proof switches: `__NO_LOOKAHEAD`, `__NO_ACTS`, `__NO_ADMIRE`,
`__NO_LAPSE`, `__NO_PAYOFF_FX`.

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
  when the chain needs slack. Across eight permanent paired ten-minute seeds,
  it wins banked value 7/8 times, 4,204 vs 3,291 aggregate (+27.7%), while
  raising the visible maximum train from three to five or six pieces.
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
- **Watchability calibration.** Thirty fixed ten-minute seeds
  (`0x5c000 + i*233`) banked 379..714 value and 72..112 pieces in 21..36
  homecomings; maximum train was 4..6, snaps 12..31, lost cargo 16..37,
  deliberate drops 0..7, apexes 3..4, events 245..337, and progress marks
  141..198. All were finite with zero impacts/rescues; the longest visible
  event lull was 721 frames and the worst story-progress lull was 2,190.
  The shared ten-minute soak records zero still seconds, an 11-second quiet
  run, a 23-second progress stall, 336 events, and 190 progress marks.
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

## Spinoff addition: PICO CAP (2026-07-10)

**PICO CAP** is a mechanic-level spinoff of a shrinking-hero adventure: a
pocket knight collects five sun shards per glade, restores the shrine, and
advances through four authored biomes (seed glade, creek hollow, hearth
house, moon shrine). Mushroom rings toggle him between BIG — sword slashes
kill gnawer beetles, chops clear brambles — and PICO, the only size that fits
through wall cracks into sealed shard pockets, but the size that gnawers hunt
and rain knocks down. Size is a real planning dimension, not a costume.

- **Two-scale state-graph planning** (`__NO_SIZE_PLAN` restores a
  threat-blind, longest-route baseline with periodic hesitation) runs
  Dijkstra over (cell × size) with pad-toggle edges priced at morph time
  plus ring cooldown, gnawer-threat costs on pico steps, storm penalties,
  and goal hysteresis. An earlier draft ping-ponged between sizes at one
  ring for 75 seconds; keeping routes across toggles plus hysteresis and
  honest toggle pricing removed it (progress stalls fell from 74s to ≤46s
  worst-case over twelve seeds). Across eight permanent paired ten-minute
  seeds the planner wins 8/8, aggregate 5,206 vs 755 on
  glades×30 + shards×3 − squishes×5; the baseline still finishes 3–12
  glades, so the panel measures a working policy, not a corpse.
- **Human-flavored control.** Three personas (BRAVE hunts gnawers, SNEAKY
  overweights threat, GREEDY overshoots for loot) rotate per glade;
  `AI.skillProfile` adds reaction delay and visible "..." daydream lapses
  behind `__NO_LAPSE`, seeded from the run seed so lapses land differently
  every run (3–9 per ten minutes, asserted >0 and ablated to 0). Human and
  bot share one `{dx,dy,act,target}` intent through `AI.controllerMux`.
- **Acts.** A rainstorm telegraphs for 240 frames — rolling front, blown
  leaves, beckoning rings, countdown — then rains for 480. Before it lands a
  pico hero routes to a ring and grows; gnawers shelter homeward; a small
  hero caught in the open is visibly soaked and stunned. If every remaining
  goal is big-unreachable the bot commits to one hysteresis-locked rain
  dive instead of freezing (an earlier draft stood still for a full storm).
  Paired `__NO_ACTS` fixtures first diverge during the warning.
- **Payoff ladder.** Tier 1 slash/shrink/grow/squish/soak, tier 2 shard and
  shrine bloom, tier 3 GLADE RESTORED after a 3-second channel beam. Tier
  frequencies are strictly ordered and tier-3 cues consume exactly 6 hold
  and ≤24 slow frames; `__NO_ADMIRE` gates only the bot pause and
  `__NO_PAYOFF_FX` is a perfect same-seed no-op. Squish is a visible bounce
  plus stun — no teleport rescues anywhere.
- **Watchability calibration.** Twelve fixed ten-minute seeds
  (`0x9c100 + i*97`) restored 15..19 glades with 80..96 shards, 50..75
  slashes, 13..31 squishes, 24..34 shrinks, 16..27 grows, 3..12 soaks, and
  2,200..2,391 events; the worst event lull was 217 frames and the worst
  progress lull 2,181. Soak asserts still ≤3s, quiet ≤5s, stall ≤45s plus
  per-seed floors on glades, shards, shrinks, slashes, brambles, and a
  both-sided squish band.
- **Authored world and visual proof.** Hedge, slate, floorboard, and carved
  moonstone biomes rebuild composition (fixtures re-carve the maze so the
  structure gates compare real layouts, not palettes). The discovered
  real-pixel eval measures the actor-scale law from drawn pixels — portrait
  diffs cap the hero at ≤22×32, pico at ≤18×20, gnawers at ≤20×32,
  shrine ≤24 wide, combined footprint <20%, scent range ≥5 tiles — beside
  walk/scuttle animation bursts, hunt-vs-roam agitation ordering, biome
  structure distances, storm breadth, payoff impact deltas, a MACHINE
  HUNT / BLOCK MINE contact sheet, and a hash-bound six-category review
  receipt.

Permanent switches: `__NO_SIZE_PLAN`, `__NO_ACTS`, `__NO_ADMIRE`,
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
