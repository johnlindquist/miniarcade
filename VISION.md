# VISION

## What this is

SIDE/QUEST is a set of self-playing 160×360 mini-games that live **beside** content:
a 4:9 vertical strip filling the column next to 4:3 video in a 16:9 YouTube frame.
Ambient motion for the developers (ADHD and otherwise) who don't sit still for a
talking head — something alive in the margin that rewards a glance and never demands
input. And genuinely entertaining: the joy of opening one and watching a bot work
out the challenge.

## The funnel

1. **Primary venue:** the side column of John's YouTube videos. The games are
   retention texture there, full stop.
2. **Secondary funnel:** a viewer who enjoys the game clicks through to the games
   page (**miniarcade.dev**), which funnels toward John's workshops and materials at
   egghead. The games themselves stay free and open source forever.
3. Everything serves "how do I get people to my workshops" — the games earn
   attention; egghead converts it.

Roadmap idea: gentle in-game promos at natural beats (goal completions, or every
3–5 minutes) — "play this at miniarcade.dev".

## The core psychology: prediction payoff

The brain loves making a prediction and watching it land. The target feeling is
relaxed forecasting: *"oh, I see where this is going"* → it happens → small dopamine
hit — with occasional delightful subversion where the bot solves it a completely
different way. Not so obvious you turn away; not so chaotic you can't forecast.

Design implications:
- Bot intent must be **legible** (visible target, readable approach) so viewers can
  predict.
- Payoffs must **land on screen** (the jump clears, the tower rises, the save
  connects).
- Occasional expectation subversion is a feature — creativity dial sits at **7–8 of
  10**: plays well, a few honest mistakes, sometimes a surprising line.

## Watchability drivers (in order)

1. **Nothing broken:** the #1 unwatchability failure is a stuck bot or a broken
   game. Every game must pass a 10-minute autoplay soak proving players are moving,
   things are happening, and progress is being made. This is the highest-priority
   standing eval work.
2. Fresh level generation and varied environments.
3. Adversarial AIs that arrive and escalate.
4. Solid, honest mechanics (Pocket League is watchable largely because the physics
   are real).
5. Items, collectibles, upgrades, goals — visible arcs.

## Focus games, not a flat roster

Both new games and deepening will happen. A few **focus games** get the most effort
and pull the others forward as references for AI, environments, adversaries, items,
upgrades, and goals (Block Mine is the current de facto focus: 46% of game commits,
2× the code of any other game, the only 30-minute soak). Some games may never earn
publication — Side Surfers currently reads as "not enough happens" (open question:
more spectacle, deeper game, or don't publish).

## Renders and length

- Published videos will be **≤15 minutes**; a good target arc is "the AI completes
  the game in ~15 minutes". 30 minutes is the outer bound; no long-stream ambitions.
- The offline renderer (`render/render.js`) + never-stuck seed searches produce the
  clips.

## Non-goals

- **No live/interactive play on the roadmap.** No John-plays, no viewers-play-live.
  Keyboard takeover exists purely so a curious visitor can try a game.
- Not trying to be *played* as a product; not photorealism; not maximal bot skill —
  a bot that never errs is a bug (see creativity dial).

## Open questions

- Whether the repo/process itself becomes teaching content is undecided. The
  emerging take: the valuable takeaway is the *process* (evals, agent-driven
  development), not the code — but the games, not the repo, may be the right
  artifact. Revisit.

## Standing orders for agents

1. Keep the evals green and push them forward; improving the bots is the
   highest-leverage ongoing work.
2. Every game must have a ≥10-minute autoplay soak asserting movement, activity,
   and progress. New games ship with one from day one.
3. Prove bot improvements with paired same-seed A/Bs; watchability bands are design
   contracts (see AGENTS.md).
