# Claude Code Guide

Read and follow `AGENTS.md` as the authoritative repository contract.

The non-negotiable quality bar is worth repeating: these games are watched, not
played. Never ship a visible pathfinding demo, an obvious corridor walk, primitive
placeholder art, or an eval that rewards motion without decisions. Exploration
games must behave like compact Zelda rooms with authored puzzle state, meaningful
route or action choices, enemies with readable agency, player reactions, and
state-changing payoffs. Prove those qualities through the behavioral and native-
pixel eval requirements in `AGENTS.md`.
