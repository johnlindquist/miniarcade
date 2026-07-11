# Claude Code Guide

Read and follow `AGENTS.md` as the authoritative repository contract.

The non-negotiable quality bar is worth repeating: these games are watched, not
played. Never ship a visible pathfinding demo, an obvious corridor walk, primitive
placeholder art, or an eval that rewards motion without decisions. Exploration
games must behave like compact Zelda rooms with authored puzzle state, meaningful
route or action choices, enemies with readable agency, player reactions, and
state-changing payoffs. Prove those qualities through the behavioral and native-
pixel eval requirements in `AGENTS.md`. Native-renderer drift never excuses a
weaker gate: use the source-bound receipt contract and keep every executable pixel
and motion assertion active on the current platform. Exploration games use the
shared `evals/motion.js` actor contract; do not replace it with a game-local proxy
or credit ordinary locomotion as an entertainment beat. Motion telemetry needs
stable persistent actor IDs, entertainment categories need independent sources,
and an ablation may disable only the mechanic it names. Keep reviewed montage
PNGs immutable during ordinary evals; update them only through the explicit
preservation command documented in `AGENTS.md`.
