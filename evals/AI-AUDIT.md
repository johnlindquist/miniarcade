# SIDE/QUEST Bot Intelligence Audit

Audit of the AI in the original eleven self-playing games, plus the three-game
fusion-max expansion and proven-improvement log for later additions, and a plan
for evals that measure what actually matters:
**fun to watch, sometimes creative, never stuck**.

Date: 2026-07-09. Sources: every game's inline bot code, `autoplay.js`, `engine.js`,
`evals/*.js`, and git history.

## Scorecard

| Game | Intelligence | Variety/Creativity | autoplay.js usage | Deliberate imperfection | Eval watchability coverage |
|---|---|---|---|---|---|
| APOGEE FOUNDRY | 5/5 — phase targeting, copied-state orbital planning, dock guidance, physical recovery | 4/5 — three personas, cutoff lapses, three mechanical upgrade stages | `controllerMux` | bounded late cutoffs, visible calibrated replans | 20 seeded 15m endings, planner and sensor-policy A/Bs, exact trajectory/show/recovery contracts |
| SKYHOOK YARD | 5/5 — exact pendulum/free-flight release planning and next-frame catcher validation | 4/5 — Rigger/Slinger/Closer profiles, showboat and steady-hands arcs | `controllerMux`, `skillProfile` | reaction delay, lapses, confidence-driven risky drops | 20 seeded 10m bands, two independent policy A/Bs, 100-job solvability, final-airship proof |
| TIDELATCH | 5/5 — copied fixed-point flow schedules with conserved water and sediment | 4/5 — three reserve/risk personas, honest dry districts and breaches | `controllerMux`, `moveToward` | persona overflow tolerance and retained failures | 20 seeded 10m bands, planner A/B, conservation/order proofs, exact River Crown |
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

6. **Misregister — three physical parallax planes with measured route planning.**
   A clockwork proofreader now moves continuously between independently projected
   yellow plate, cyan blanket, and magenta stock surfaces; every plane owns its
   phase, acceleration/braking, collision restitution, seams, hazards, and marks.
   Transfers have a 12f cancelable wind-up, immutable commit, continuous depth
   travel, and frame-48 footprint/relative-speed validation; failures tumble or
   ride a visible 72f paper-return chute instead of teleporting. The copied-state
   register planner is permanently ablated by `__NO_REGISTER_LOOKAHEAD`: across
   12 paired ten-minute seeds it won 12/12, printed 299 vs 256 posters (+16.8%),
   stayed inside the 0..2 chute band (2 vs 0), and kept both policies above .99 normalized
   plane-occupancy entropy. A golden-ratio-spaced 30-seed calibration measured
   20..28 posters, 87..122 transfers, 92.0..95.1% clean landings, 8..11 smudges,
   0..1 chutes, and 28.6..38.1% occupancy per plane. PAPER JAM and SOLVENT WASH
   first change applied physical intent and actor motion during their exact
   240f/210f warnings, never merely a tactic label. The shipping soak records
   0s frozen, 8s quiet, 17s without story progress, balanced 36.5/32.2/31.3%
   plane dwell, both transfer edges 52/53 times, and zero hard
   rescues; poster apexes spend exactly 6 held + 18 slowed + 42 admire frames.
   2026-07-09 the game shipped a presentation-only genre realign to **PRESS RUN**:
   the cream letterpress diorama became a dark press-hall of three conveyor
   belts (family palette, rect-stack pressman, chunky stamp pickups, floating
   pop text, an always-visible page-under-construction in the station strip),
   with "misregister" demoted to the smudge failure state. The realign was
   proven a perfect sim no-op — 10-minute signatures on three seeds match the
   pre-change build byte-for-byte — so every band, A/B, and calibration above
   still holds unchanged.

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

## Fusion-max expansion: three new simulation families (2026-07-09)

Council session:
`~/.fusion/sessions/2026/07/09/2026-07-09T23-58-46-002Z-e3db4e`.
The selected slate deliberately avoids every existing primary mechanic:
conserved-fluid routing, pendulum logistics, and orbital phasing/construction.

1. **Tidelatch.** Twenty measured ten-minute seeds produced 134–156 deliveries,
   5–19 dry failures, and 0–2 breaches. The copied-state flow planner beat greedy
   routing 10/10 seeds and raised median deliveries 122.5→144.5 (+18.0%).
   Water/sediment ledgers and edge-order independence are exact; breach repair is
   a physical drone trip. The 12-minute River Crown spends exactly 6 held, 18
   slowed, and 36 admire frames. The council's provisional 40–120 delivery range
   was rejected after measurement; the permanent 125–190 band is derived from
   the 20-seed distribution with margin.
2. **Skyhook Yard.** The release planner beats reactive sight-lines 10/10 seeds
   (141 vs 56 catches, +152%). A separate stale-release guard A/B reduces crashes
   23→16 while preserving catches (129 vs 125); `__NO_RELEASE_GUARD` restores
   the complete old patience policy. Across twenty ten-minute seeds: 61–73
   catches, 3–9 crashes, 1–6 visible salvages, 70–77 releases, and a 16.2s worst
   release gap. All 100 legal job fixtures solve, and the final engine unfolds
   into an airship lift at 12.32 minutes.
3. **Apogee Foundry.** Twenty fixed seeds consume exactly 20 delivered parts to
   build Relay/Habitat/Crown and ignite 20/20 endings; all three personas and 20
   distinct outcomes appear. Phase planning wins 9/10, improves median docks
   9→12.5, and cuts p95 first capture 2878→693f. No fragment position or velocity
   reset is invisible. Two independently ablated sensor fixes prove depot handoff
   (10000→1657f progress lull) and physical pursuit calibration (5814→2064f);
   replan/calibration behavior stays under 14.4% of commands across all endings.
   Exact apex accounting is 6 hold / 24 slow / 60 kernel admire / 38 executed
   admire, with zero sticky or ablated commands. After fixing the real
   handed-off-fragment chase, the 20-seed progress-lull range was 29.3–63.7s;
   the permanent ceiling is pinned at 65s rather than the rejected provisional
   180s allowance.

All three retain `__NO_PAYOFF_FX` same-seed simulation parity, exact 180–240f
act telegraphs with physical warning-phase divergence, common human/bot intent
paths, three native-resolution 60-second render probes, and deterministic
15-minute ending renders.

## Fusion-ultra spectator-story repair (2026-07-10)

Council session:
`~/.fusion/sessions/2026/07/10/2026-07-10T03-03-13-075Z-293c6b`.
All six seats completed without quota degradation. The consensus rejected telemetry-first
polish: the common failure was causal storytelling — the viewer could not reliably see
one actor, one target, one intended path, a plain verb, persistent progress, and the
payoff that advanced the ending.

1. **Skyhook — every catch now visibly builds an airship.** The HUD says
   `BUILD AIRSHIP`, the green catcher is a dominant target, the release forecast says
   `ON TARGET` / `SHORT` / `LONG`, and the hull is recognizable from frame one.
   The previously unrendered `placedPieces` now persist as 1/3 -> 2/3 -> locked module.
   `__NO_VIEWER_STORY` and `__NO_PARTIAL_HULL` restore the old presentation with
   identical simulation signatures. `__NO_LONG_LAUNCH` restores the 342-frame finale;
   the shipped ceremony is 982 frames, with identical pre-launch outcomes and exact
   6/24/48 show budgets. Twenty-seed outcome bands remain 61..73 catches, 3..9 crashes,
   1..6 salvages, 20..24 modules, and 70..77 releases.
2. **Tidelatch — the route now explains the city.** A persistent `LIGHT CITY x/4`
   goal, causal action line, River Crown forecast, cream planned route, one highlighted
   district, and four distinct district silhouettes replace the engineering dashboard.
   `__NO_VIEWER_STORY` / `__NO_FLOW_STORY` are simulation-exact. The separately
   ablated `__NO_EARLY_CITY_ARC` restores 0/150/300/450-second unlocks; the shipped
   0/75/195/315-second arc won 10/10 same-seed comparisons and raised median deliveries
   143 -> 161 (+12.6%) while retaining 138 dry/breach failures, including four breaches.
   Fresh runs stayed inside 152..182 deliveries, 9..21 dry events, and 0..3 breaches;
   Crown timing remains exact at 6/18/36.
3. **Apogee — scrap, tug, dock, and ring now form one visible chain.** One enlarged
   tug and selected salvage dominate the field; all 12 ring slots exist from frame zero;
   banked parts remain physical at the construction socket; the mission loop reads
   `GET SCRAP -> TOW TO DOCK -> PLACE PART`. `__NO_VIEWER_STORY` and
   `__NO_MISSION_STORY` preserve exact simulation parity. `__NO_PROMPT_IGNITION`
   restores the old 48,000-frame ignition: the shipped ring ignites at frame 45,300,
   five seconds after honest final construction at 45,000, still spending exactly 20
   parts. All 20 seeded endings, three personas, 20 distinct outcomes, and exact
   6/24/60 kernel / 38 executed admire budgets remain intact.

The shared session API now accepts `{viewer:true}`: gallery previews and recordings
show no play prompt, while direct pages reveal a low-contrast `ENTER · TAKE OVER`
affordance only after eight seconds. Native 160x360 first-minute and ending renders
were visually reviewed. Automated checks prove truth, timing, persistence, parity, and
band preservation; a blinded naive-viewer comprehension/preference study remains the
honest next evidence layer because counters cannot prove fun.


## Fusion-ultra addition: CRESTCRASH (2026-07-09)

Council session:
`~/.fusion/sessions/2026/07/10/2026-07-10T00-19-37-808Z-244d24`.
All six seats completed successfully. Five seats and the finalizer selected the
one-body design: terrain stores the launch energy and the ridge runner itself is
the projectile. One seat proposed a detachable bolt; that mode split was rejected.

**CRESTCRASH** implements the council's irreducible core: deterministic generated
ridges, one shared human/bot intent and physics path, physical support-graph tower
collapses, a copied-state arc planner, honest misses and shell repairs, Headwind and
Plating acts, a strict three-tier show ladder, and an earned frame-54,000 ending.
The maximum-speed terrain sweep uses bounded deterministic chord sampling and a
refined first-contact time, so neither runtime nor planner can tunnel through a
crest. The exposed-joint recovery is also physical: the joint lowers visibly over
36 frames and the bot replans; `__NO_EXPOSED_RECOVERY` restores the old geometry.

Thirty fixed ten-minute seeds on game SHA-256 `232b6f19...` were all finite and
reset-free. Measured p05..p95: 111..126 launches, 108..122 landings, 108..120
impacts, 90..99 joint breaks, 13..15 core breaks, 21..30 misses, 14..22 tumbles,
3..4 repairs, 6..9 recoveries, and 3..5 coil recoveries. Every run produced four
warnings, lands, and real structural changes for each scheduled act. The maximum
viewer-time break gap was 1,193f against the hard 1,200f contract; maximum story
lull was 985f and maximum one-step capsule motion was 4.604px.

The planned arc policy won payoff rate 12/12 same-seed five-minute pairs: 78.6%
versus 39.9% (+38.7 percentage points), with 82 versus 59 cores and median maximum
payoff lull 780f versus 1,082.5f. Across thirty additional paired ten-minute runs,
visible exposed-joint recovery reduced mean/median maximum break gaps from
977/876.5f to 831/795.5f, eliminated five hard-gap breaches (5 -> 0), and improved
aggregate breaks 2,836 -> 2,856, cores 414 -> 422, misses 803 -> 776, and progress
5,857 -> 5,894. Permanent switches are `__NO_ARC_PLAN`,
`__NO_EXPOSED_RECOVERY`, `__NO_ACTS`, `__NO_ADMIRE`, and `__NO_PAYOFF_FX`.

Deliberate council cuts are recorded rather than hidden: the narrow-strip release
omits defender NPCs, slag rollers, shutters, wardens, branching upgrades,
secondary-joint variants, and the proposed three-tower Crown staging. It keeps
time-gated deterministic upgrades, escalating target mass/support geometry, two
measured acts, and a single earned Crown target. The planner replans every 60f
rather than the proposed 12f to keep headless and production CPU bounded. These
cuts follow the council's defender/secondary-system cut order and do not weaken
the measured watchability, determinism, act, show, or ending contracts.

## Northstar: CRESTCRASH joins the viewer-story contract (2026-07-09)

Picked as the northstar because crestcrash shipped from its own council and was
the only new simulation left outside the fusion-ultra causal-story consensus
(one actor, one target, a plain verb, persistent progress, payoffs that visibly
advance the ending). Its ending contract — 80 relays, 10 cores, and the Crown
Array by frame 54,000 — was computed but never shown: the HUD gave a raw relay
count with no quota, the tactic line spoke bot jargon, and a viewer had no way
to forecast whether the current flight would connect. That is exactly the
prediction-payoff gap VISION.md names as the core psychology.

The presentation-only layer (gated by `__NO_VIEWER_STORY`, like skyhook,
tidelatch, and apogee):

- **Persistent goal HUD.** `TOPPLE RANGE xx/80` with a relay progress bar, ten
  core pips, and a crown chip that pulses while the Crown Array is targeted and
  lights when it breaks — the whole 15-minute contract visible from frame one.
- **Plain-verb line.** DIVE FOR SPEED, CLIMB TO CREST, BRACE TO STRIKE, CUT THE
  HEADWIND — replacing the engineering tactic strings.
- **Truthful flight forecast.** Every airborne frame projects the body through
  the exact runtime integrator (copied state, no RNG) against the live joint and
  labels the arc ON LINE / SHORT / LONG.
- **Target callout.** STRIKE HERE over the live joint; a RELAY AHEAD edge chip
  when the joint is off screen.

Eval section 12 proves the frame-one HUD reads `TOPPLE RANGE 00/80`, the drawn
receipts match simulation truth after two minutes of play, each forecast label
matches its own projection's miss distance and sign, the 2-minute rendered A/B
signature against `__NO_VIEWER_STORY` is identical, and the next engine RNG draw
is untouched. A blinded naive-viewer comprehension study remains the honest next
evidence layer here too.

## Genre-fusion addition: MOTO BOWL (2026-07-10)

**MOTO BOWL** crosses Tecmo Bowl with Excitebike: downs, play calling, and
coordinator reads give the drama its grammar; throttle heat, ramps, whoops,
mud, and oil give every snap its physics. One rusher (with two escort
blockers) runs a 15-minute title match against a role-disciplined defense —
linemen fire off the ball, backers mirror and fill, corners backpedal to cut
breakaway angles, safeties keep depth — while the rival's off-screen offense
scores on a fixed broadcast schedule. The match ends, win or lose, exactly at
run frame 54,000.

Core contracts, all in `motobowl-eval.js`:

- **One physics path.** Human, bot, and every planner rollout pass through the
  same `advanceBike`; the planner fixture proves purity, repeatability, exact
  replay (error 0), and zero engine-RNG consumption.
- **Level gen is proven, not vibed.** Each drive's ramps/mud/whoops/oil come
  from sim RNG through `AI.generateValidated`, with a corridor validator over
  every 25-yard window; the eval generates 100 drives (100/100 valid, 23
  distinct layout shapes).
- **Copied-state lane planning** (`__NO_LANE_PLAN` restores widest-gap
  reactive running): candidate lanes x turbo policies roll the exact
  integrator and the exact defender pursuit 90 frames ahead. Won yards per
  play 10/10 paired five-minute seeds, 12.83 vs 8.84 (+3.99), touchdowns
  68 vs 32 (+113%).
- **Tendency-mixed play calling** (`__NO_PLAY_MIX` restores argmax): the
  defensive coordinator keys the offense's most frequent recent call (pure
  history math, no RNG); the bot charts its own tendencies and dodges the
  read unless the best play is a blowout. Keyed-play rate 14.2% vs 48.9%
  (-34.8pp), 8/8 paired seeds.
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

Thirty fixed ten-minute seeds (0xd000 + i*233) were all finite: 136..148
plays, 6..17 TDs, 56..73 first downs, 120..142 tackles, 2..31 broken tackles,
3..19 hurdles, 57..122 jukes, 260..289 blocks, 6..28 ramp launches, 0..8
overheats, 4..16 tumbles, 3..13 turnovers, 8..33 keyed plays, 817..929 events,
198..217 progress marks; worst story lull 717f, and the worst visible-event
lull is a deterministic 262f (the touchdown-celebration-to-kickoff pipeline).
A 20-seed 15-minute panel scored 98..154; the rival schedule is pinned at 98
(the panel's 10th percentile), so most titles are won late and the flattest
matches genuinely lose on the tiebreak. Football's own rules are the anti-
stall layer: the play clock, the forward-progress whistle, and turnover on
downs bound every possible wedge, and the shipping soak records 1s still /
4s quiet / 7s stall over ten minutes with zero rescues of any kind.

Deliberate cuts, recorded rather than hidden: no passing game, no special
teams (a failed 4th down is always a turnover), no player-controlled defensive
possessions, and the rival plays entirely off-screen on a deterministic
schedule. Permanent switches: `__NO_LANE_PLAN`, `__NO_PLAY_MIX`, `__NO_ACTS`,
`__NO_ADMIRE`, `__NO_LAPSE`, `__NO_PAYOFF_FX`, `__NO_VIEWER_STORY`.

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
