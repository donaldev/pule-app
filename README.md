# Pule — The next frame

A local, six-screen React + TypeScript + Vite visual prototype. Every player, venue, match and statistic is fictional. The frame-scoring behavior is an unvalidated interaction hypothesis, not a reproduction of the predecessor.

## Run locally

```sh
npm install
npm run dev
```

Open the Local URL printed by Vite (usually http://localhost:5173). Dependencies are already installed in this workspace. Use `npm run dev -- --host 0.0.0.0` to preview on a phone on the same trusted network, using the Network URL Vite prints.

```sh
npm run build
npm run lint
npm run preview
```

## Explore

- `#/play`: Home, resume the preloaded demo or create a new one.
- `#/setup`: choose fictional players, venue and a provisional frame target.
- `#/live`: award frames, Undo, pause/resume timer, open the event timeline, switch bright/dark scoring theme, review and complete when a player reaches the target.
- `#/recap/m12`: example recap with a complete fictional frame sequence and comeback story. Other match links demonstrate result-only recaps.
- `#/recap/current`: recap of your completed in-memory demo.
- `#/profile`: Alex's profile, form ribbon, rivalry and record evidence.
- `#/insights`: period/opponent filters, result summaries, accessible chart table and contributing matches.
- `#/matches`: browse the twelve shared fixture results.

The Preview state selector exposes ready, empty history, loading, offline, simulated save failure and conflict. Loading is deliberately held until you choose Ready. Failure/conflict previews block scoring without simulating a backend. Resume preserves the match only while this app instance remains open. Refresh resets it. The timer starts paused in the preloaded demo; new matches start a running timer. Pausing the timer does not disable scoring.

## Boundaries and placeholders

No authentication, storage, service worker, installation/PWA support, production sync, database, historical import, external fonts, remote imagery, or connected services. Offline is a visual state, not a guarantee of offline reload. No server-confirmed results exist. Completed demo matches do not enter the static profile/insight fixture history.

Sharing offers a redacted preview and copies explicitly labeled fictional text via the browser clipboard where available. It does not publish, send messages, export an image, or create public URLs. Earlier-event editing, identity editing, ratings and real achievements are deferred. Timer values are illustrative, not authoritative. Browser tests and accessibility/device validation should precede any production implementation.

## Structure

`src/app` owns the shell and hash navigation; `src/features` owns Home, scoring, matches, players and insights; `src/components/ui` contains reusable primitives and icons; `src/data/fixtures.ts` contains the single fictional match dataset. Scoring uses a small typed reducer and an in-memory frame/undo journal. Tailwind's Vite integration and utilities follow the [official setup](https://tailwindcss.com/docs/installation/using-vite); product tokens and responsive component treatments live in `src/index.css`. No chart or routing library is needed for this prototype.

See `docs/PRODUCT_PLAN.md` for the broader architecture and `docs/PROTOTYPE_NOTES.md` for implementation scope and review guidance.
