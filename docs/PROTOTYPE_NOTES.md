# Visual prototype review

Implemented following the six-screen experience plan. The user's subsequent request authorizes local prototype implementation; production architecture remains proposed/approved in principle as recorded in PRODUCT_PLAN.md. The plan's earlier “implementation not yet authorized” text records the previous planning milestone, not the scope of this prototype.

## Direction

The selected “Felt / after hours” direction uses an ink canvas, green table plane, chalk scores, serif editorial accents, paired rail geometry and brass details. CSS-drawn ball and cue artwork needs no external assets. An alternative bright-venue treatment is available with the sun control on Live Scoring. This delivers one coherent implemented identity with a light scoring variant; a separate second full identity study remains for future design review.

## Evidence

All numbers come from twelve explicitly fictional result fixtures (Alex: seven wins, five losses). Jamie's rivalry is three wins each over six meetings. Results are ordered newest first with unique occurrence dates. All use the same hypothetical race-to-five format. The latest example's full frame sequence starts with three Jamie frames followed by five Alex frames, supporting its three-frame-deficit comeback. Other samples deliberately have final scores only. No shot details, technique improvements, predictions, or pressure-performance claims are made.

Profile winning streak is derived from the full fixture sequence; its evidence dialog shows one qualifying two-win run. Insights filters derive numerators and denominators from eligible fixtures, display the sample count, provide a visible data table and disclose small-sample/selection limits. The date interval is fixed fixture coverage, not a live reporting period. User-played demo results do not modify these illustrative records.

## Local behavior

Hash routes support back/forward and direct entry with no routing dependency. In-memory state survives screen navigation but not reload. Frame actions have stable positions; Undo appends a compensating event; paused timer and match completion are explicit. A new match asks before replacing an unfinished journal. Reaching the provisional target disables awards but allows Undo, then explicit review/completion. No persistence reliability is claimed. The timer is an interaction demonstration and may drift under browser throttling.

Use the preview-state selector to inspect empty, held loading, offline, save failure and conflict appearances. The latter two are synthetic blocking states, not failed network writes. The timeline demonstrates frame/undo history; editing earlier events is deferred. Share preview uses initials by default and copies demo text only on explicit action.

## Review tasks

1. On a narrow phone, resume, award a frame, undo it, pause/resume the timer and inspect the timeline.
2. Leave for Home, resume and confirm the same in-memory score; refresh and confirm the clearly documented reset.
3. Start a race-to-three with different players, reach the target, undo and re-award, review, complete, then inspect its recap.
4. Compare the full-sequence sample recap with a result-only match. Check that no comeback is invented for the latter.
5. Inspect profile records, rivalry filters, period changes, chart table and contributing matches.
6. Preview a share result, toggle initials, and explicitly copy its fictional text.
7. Inspect every preview state; use Ready to recover. Toggle light scoring, use keyboard controls, enlarge text and test at 320px.

No real-match validation, predecessor inspection, backend implementation or deployment has occurred. Prototype review cannot establish production correctness, RLS, durable offline recovery or full accessibility conformance.
