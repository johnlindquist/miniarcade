# Agent Guide

MINI/ARCADE is the canonical production repository for
[miniarcade.dev](https://miniarcade.dev). It contains the static gallery,
self-playing games, shared runtime, and deterministic eval suites.

## Verify

Run `npm test` before every commit. New games must include focused eval coverage,
including a deterministic ten-minute autoplay soak that proves movement, activity,
and progress.

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
