# Frame replays — Phase 1

Local implementation only. Database foundation and connected Frame History playback are included. No hosted migration, production Storage operation, commit or deployment was performed.

## Schema and authorization

`app.frame_replays` uses `frame_id` as its primary key (one replay per frame),
with `group_id`, `session_id`, a unique `storage_path`, and `created_at`.
The composite FK references `app.frames(group_id,session_id,id)` with
`ON DELETE CASCADE`. Paths must equal `<session UUID>/<frame UUID>.mp4`;
the bucket is always `frame-replays`. No URLs or tokens are persisted.
A trigger requires a completed frame when privileged operators attach metadata.

Authenticated clients have SELECT only, through the unchanged
`app.session_visible(group_id,session_id)` predicate: active group membership,
active group, non-abandoned session, and accepted import batch where relevant.
Identity linking is not a separate playback permission. Existing claiming and
matchup membership rules continue to determine group membership.

Storage SELECT requires an exact path registered in visible replay metadata.
Restrictive policies also fence this bucket against unrelated permissive policies:
anonymous reads and client INSERT/UPDATE/DELETE are blocked. Other buckets retain
their existing policies. Dashboard/service operations must use their usual trusted
RLS-bypassing role; no service credentials belong in the browser.

## Migration prerequisites and seed

Apply after `202611080001_automatic_player_identity.sql`. The migration requires
Supabase Storage and an existing private `frame-replays` bucket; it aborts if the
bucket is absent or public. It does not create or alter buckets or Storage objects.
Use a migration role permitted to create policies on `storage.objects`.

The supplied session `8926207a-9936-5762-a991-492b45ef7e50` and frame
`366064c1-d7d3-5bf6-a17b-131fa5cf1fbb` are registered with the supplied path,
deriving the group from the completed frame. The insert does nothing if the parent
is absent or incomplete (including fresh databases) or metadata already exists;
it never manufactures history or overwrites an attachment. After a future approved
deployment, verify that exactly one matching row exists and that its MP4 is present.
The migration does not prove the uploaded bytes exist or are a valid MP4.

## Connected Frame History playback

Expanding connected SessionView Frame History reads replay metadata through the
existing authenticated Supabase client and session-scoped RLS query. Only completed
frames with matching registered metadata show Watch Replay. Tapping it calls
`supabase.storage.from('frame-replays').createSignedUrl(storage_path, 60)`.
Storage checks the caller's JWT and SELECT policies before issuing the temporary
URL. Use it transiently for playback, handle expiry by requesting a fresh URL,
and never persist it in match history or logs. The dismissible modal uses a mobile
inline video player with native controls. Availability, signing and playback failures
show local messages; fresh links and availability checks require explicit user
action. There is no polling, automatic replay retry or scoring RPC. Closing history,
changing account/session or dismissing the modal discards pending playback results.
This SELECT permission also permits
authenticated downloads; it is not a signing-only permission.

Signed URLs are bearer links: anyone holding an issued URL can use it until expiry.
Revoking membership or removing metadata prevents new URLs, but does not revoke
already issued links. Keep expirations short. Confirm playback and range requests
against a full Supabase Storage service before production release.

## Removal and outstanding cleanup

`app.remove_match` already deletes frames for both abandon and permanent deletion.
The FK atomically cascades replay metadata without changing the removal command,
audit, scoring, correction, or receipt functions. The Storage read policy then
denies new access because no registered metadata remains.

**Database deletion does not delete Storage bytes.** Phase 1 deliberately leaves
the private object for trusted manual cleanup. Before removing a match, an operator
should record its registered object paths; afterward verify the match and replay
metadata are gone, then delete those exact objects through the Supabase dashboard
or trusted Storage API. For an already removed match, inspect its session UUID
prefix and confirm removal before deleting any file. Never delete rows directly
from `storage.objects`: that removes metadata without deleting the underlying file.
No cleanup trigger, network call, browser control, or automatic prefix deletion is
introduced. Automatic durable cleanup remains future work; orphaned private files
consume storage until an operator removes them.

## Verification

Run `python3 -B scripts/database/run_tests.py --sql-test frame_replays.sql` and
`python3 -B scripts/database/run_tests.py`. The runner uses a new disposable local
PostgreSQL database, synthetic identities, and a minimal Storage schema stand-in.
Replay tests cover viewer/isolation/revocation/import visibility, exact-object
reads, restrictive fences under a deliberately broad policy, denied client writes,
completed-frame attachment, composite FK, correction preservation, and actual
match removal cascading metadata while retaining inaccessible Storage metadata.

Also run the focused `match_removal.sql` and `frame_correction_details.sql` suites
using `--sql-test`. The full suite includes `player_identity.sql`. The pre-existing
`automatic_player_identity.sql` test file is now present; the earlier missing-file
warning from the database-only checkpoint is obsolete. The harness does not test
GoTrue, PostgREST, actual signing, public endpoints or bytes. On a disposable full
Supabase stack, verify authorized signing/download succeeds, unrelated/revoked/anon
signing fails, unregistered paths fail, uploads/replacement/deletion fail, the public
object URL fails, and removal blocks new signed URLs. Review deployed bucket privacy
and policies before rollout; this task does not inspect or modify remote state.

Local verification on 2026-11-10: replay suite 27 assertions; full suite 212
assertions plus five concurrency checks on both fresh and existing-foundation
upgrade runs; focused removal 36 assertions; focused
correction details 23 assertions. All passed against PostgreSQL 14.8.

References: [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[signed URLs](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl),
and [Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects).

## Frontend verification

`node --test scripts/frontend/frameReplays.test.mjs scripts/frontend/frameEntry.test.mjs scripts/frontend/matchRemovalUi.test.mjs scripts/frontend/playerInitialization.test.mjs scripts/frontend/identityReceipts.test.mjs scripts/frontend/startupRecovery.test.mjs`
passed all 46 tests, including 12 replay tests covering availability, authenticated
metadata/signing, private bucket and 60-second expiry, account changes, loading,
failures, explicit renewal, dismissal and stale-result suppression. These use
mocked clients/component hooks, not a live Storage service or browser media decoder.
`npm run lint` and `npm run build` (including TypeScript project checks) passed.

Frontend files: `src/data/remote/replayService.ts`, `database.types.ts`,
`src/features/connected/FrameReplays.tsx`, `SessionView.tsx`,
`src/app/connected.css`, `scripts/frontend/frameReplays.test.mjs` and the existing
`matchRemovalUi.test.mjs` harness. Both migration files remain unchanged.
Deployment still requires the reviewed migrations in order, private bucket/seed
verification and real-stack authorized/unauthorized playback checks.

## Local shot index proof of concept

With the replay worker's Python dependencies and FFmpeg/FFprobe installed, run:

```sh
python3 scripts/replay/shot_index_poc.py recording.mp4 corners.npy /tmp/pule-shots --extract 1 3 4
```

Use a new output directory and choose extraction numbers appropriate to the
fixture. The prototype captures the detector's motion ranges before padding
and merging, then calls the normal renderer. It uses decoded source frame
timestamps and matches rendered segment frames to measured timestamps in
the final MP4. The source-to-segment correspondence still depends on the
existing seek and encode behaviour, so reported times are estimates of motion
boundaries. The JSON end timestamps are exclusive, and `duration_seconds`
measures the source interval.

On the 35-second local pool fixture, four motion ranges produced three replay
segments. Ranges 2 and 3 stayed separate inside the same segment. Visual review
suggested range 2 was cue setup and range 4 included player occlusion. Sampled
review cannot establish a missed-shot rate. Verify against manually labelled
recordings before proposing a persistent shot index. This prototype writes
local files only.

### Full-frame review

Generate the replay and index with the same local prototype. Put a
browser-playable copy of the full recording named `source.mp4` alongside
`replay.mp4` and `shots.json`. If transcoding is needed, preserve the original
presentation timestamps and avoid trimming. Generate and serve the viewer
from the repository root.

```sh
python3 scripts/replay/build_shot_review.py /tmp/pule-full-frame-compatible --source-name frame_original.mp4
./node_modules/.bin/vite /tmp/pule-full-frame-compatible --host 127.0.0.1 --port 5193 --strictPort
```

Open `http://127.0.0.1:5193/review.html`. Loopback HTTP supports seeking
and clip downloads in Chrome. Review each detection and play the entire
original to flag omissions. Export the review JSON to retain the labels and
notes independently of browser storage. Precision is genuine detections
divided by classified detections. Recall is genuine detections divided by
genuine detections plus manually noted missed shots. The viewer reports
these only after all detections are resolved and the reviewer confirms the
entire source was reviewed.

The first full-frame pass used a browser-compatible 1280 × 2276 H.264 copy of
the 311-second `frame_original.mp4` with all 9,265 input video frames and
scaled calibration points. It produced 40 motion detections in 20 segments
with no overlapping indexed replay boundaries. The 4K HEVC original was
not run to completion. The review copy may yield different detections, and
the detection totals are pending manual classification.

### Interactive local replay creation

Open `http://127.0.0.1:5194/` after starting the isolated Vite entry from the
repository root with the replay worker's NumPy/OpenCV dependencies and
FFmpeg/FFprobe available.

```sh
./node_modules/.bin/vite --config src/dev/shot-review/vite.config.mts
```

Set `PULE_SHOT_PYTHON` to a Python executable with those dependencies if they
live in a virtual environment. Use Chrome to pick an MP4, confirm the four
corners, and create a replay. Originals over 200 MB require compression.
Smaller files can opt in. The normal WebCodecs encoder and MediaRecorder
fallback run in the browser. The selected or compressed input is streamed
only to the Python processor on this Mac. Each successful run keeps its
media, index, and standalone viewer in a unique temporary directory. Export
the review JSON before clearing browser data or temporary files.

The index keeps decoded source timestamps for the detector's raw motion and
separate presentation timestamps for the engine's two-second lead-in and
half-second tail. The engine's settling logic and normal merged replay are
preserved. Individual presentation ranges may overlap. The existing renderer
uses nominal timing when deciding what to keep, so variable-frame-rate inputs
can have less lead-in against decoded source timestamps. Individual clips are
re-encoded from the final replay for accurate seeking and keep its displayed
orientation and dimensions. For a compressed run, the viewer's source is the
compressed input used by the engine.

### Local temporal motion experiment

`scripts/replay/temporal_motion.py` samples the existing detector's decoded
table frames around each indexed motion interval. It measures compact motion
lobes, onset rate, short trajectories, estimated acceleration and settling.
A linked lobe is evidence of moving image contrast, which can also come from a
cue, a hand or a shadow. The experiment does not edit replay media or indexes.

```sh
python3 scripts/replay/temporal_motion.py REVIEW_FOLDER MANUAL_REVIEW.json /tmp/pule-temporal-motion.json
``

On `sean_double_compressed.mp4`, trajectory persistence separated genuine
detections from false positives best by rank (AUC 0.871), but three genuine
detections yielded no qualifying track. Sudden onset and settling showed
little separation. A rule that flags low compact-motion share only when a
qualifying track is absent flagged six false positives and no genuine shots
when fitting the cutoff on one half and checking the other, then reversing
the halves. The rule was explored on this recording, so the split checks its
sensitivity to timing within the frame. Independent labelled recordings are
needed to establish reliability.

The 47-detection review had 23 genuine, 23 false positives and one uncertain.
The combined rule retained all 23 genuine and the uncertain detection, raising
precision among resolved labels from 50.0% to 57.5%. Recall against the 23
known genuine shots stayed at 100%, with no missed shots reported. Measuring
temporal features on existing decoded frames added about 4.4 seconds of work.

On a second recording, the fixed 1.3% compact-motion cutoff with track rescue
flagged two of 40 detections. Sampled frames suggest player occlusion and cue
setup in those windows. There are no independent full-frame labels for that
recording, and occlusion can hide real ball motion. Keep the signal as a
review aid and stop tuning it as an automatic exclusion rule until more
fully labelled recordings and visibility checks are available.

### Local pool ball recognition feasibility

`scripts/replay/ball_recognition.py` compares the labelled recording's original
and compressed files with the same calibrated table corners. The script
detects candidates in the unwarped table crop using Hough circles, colour
contours and local contrast. It projects approximate contact points into a
480 × 240 table view and links candidates by position, velocity and colour.
Warping the cloth plane stretches the appearance of balls in this low-angle
recording, so the rectified view is for visualization. Track IDs are temporary
and are not ball numbers.

The seven-frame spot check measured about 9–16 pixels across in the 720p
compressed file and 13–24 pixels in the 1080p original, using isolated examples.
The compressed file returned 45 matches, 14 false positives and 13 misses.
The original returned 46 matches, 33 false positives and 12 misses. The
evaluation ignored ambiguous rack and glare regions and used a 5.5-pixel
centre tolerance in compressed coordinates. The sample is too small to
isolate the effects of resolution, compression and frame rate.

Both videos produced fragmented tracks during the break and under occlusion.
Keep this detector out of shot classification. An offline benchmark with a
licensed pretrained detector is warranted if ball tracking remains a goal.
Confirm accuracy on the actual low-angle footage and CPU cost in the replay
worker image before considering integration.

### Local pretrained ball detection benchmark

CueDetat's AGPL-3.0 ball/cue TFLite segment ran on the Intel Mac using
LiteRT.js CPU WebAssembly from an isolated temporary directory. Its embedded
metadata identifies class 1 as pool ball. Scoring the same seven hand-checked
frames at a 0.25 confidence cutoff with a calibrated position and plausible
ball-size filter gave 16 matches, no false boxes and 42 misses. Two
overlapping crops gave 24 matches, one false box and 34 misses. The
classical baseline had 45 matches, 14 false boxes and 13 misses.

The 3 Hz run sampled 603 images across all 47 labelled motion windows.
Short, direction-consistent associations confirmed motion in three genuine
shots. The conservative visibility gate still rejected three genuine shots
and removed only two false positives. At 1.5 Hz it rejected two genuine and
removed one false positive. At 0.75 Hz it made no exclusions. The uncertain
detection was retained in every comparison. Lower-rate results were
subsampled from the 3 Hz run. The full run took 153.5 seconds elapsed, with
147.1 seconds in the model call and output readback and a 232 ms median per
sample. Native Linux CPU inference and memory use remain unverified.

Pix2Pockets publishes a PyTorch checkpoint and reports 91.2% AP50 on its own
still-image test. The checkpoint's commercial-use terms and a lightweight
CPU export remain unverified. CueDetat's separate MIT app license does not
substitute for its weight license. Neither candidate is approved for
production. Do not pursue a second recording for CueDetat given the
regression in known shot recall and the CPU overhead.

### Local stationary ball displacement experiment

`scripts/replay/stationary_displacement.py` compares local template matching
and forward/backward optical flow on short windows around the existing raw
motion boundaries. It seeds anchors with ball candidates that stay at the
same position in three pre-onset samples. A confirmation needs consecutive
directionally consistent displacement and a recognizable ball at the new
position. Disappearance alone does not count. The brightest pale anchor is
a cue-ball proxy and was not independently identified as the cue ball.

On the 47-detection manual review, template matching confirmed five genuine
shots and zero false positives. Optical flow confirmed three of those five.
The pale-anchor variant confirmed one genuine shot. A conservative
stationarity rule flagged six false positives and zero genuine shots,
retaining the uncertain detection. No adjacent pair met the motion-gated
consolidation rule. Timing alone found eight false-positive-to-genuine
pairs within three seconds, but also found genuine-to-other pairs and
chains of multiple false positives. Keep their original boundaries.

The experiment leaves unconfirmed shots visible. Its results are promising
as review evidence, but the low rate of positive confirmations and lack
of another fully labelled recording preclude a reliable automatic filter.

### Local manual ball tracking diagnosis

The local diagnostic viewer lets a reviewer choose a decoded frame and mark
ball centres in five missed genuine shots. It uses the existing template and
optical-flow trackers with their existing thresholds. Frame selection uses
source presentation timestamps, and tracking receives every decoded frame
from the selected point onward. The annotated MP4 plays slowly for inspection
and shows native timestamps. This tool writes local diagnostics only.

```sh
python3 scripts/replay/manual_tracking_diagnostic.py REVIEW_FOLDER OUTPUT_FOLDER
```

Open the loopback address printed by the tool. The five reference selections
confirmed shots 18 and 42 at native cadence. Both failed when fed every
second frame from the same selected position. Automatic anchors collected
at the same reference frame also confirmed those two at native cadence.
Shots 6, 12 and 32 remained unconfirmed with reference marks. Their logs
showed template mismatch, reverse-flow mismatch and failure to recognize
the ball again. Across all 18 misses, 12 never logged a 6-pixel accepted
shift. The other six reached that displacement without the required
consecutive movement. The audit does not establish a single cause for
every failure.

The user's manual marks independently reproduced the reference results.
Shots 18 and 42 confirmed on consecutive native frames, and both failed
with every second frame using the same marks. Shots 6, 12 and 32 stayed
unconfirmed at native cadence. The break produced an isolated confirmation
when subsampled, which was not verified as a continuous ball track.

### Local combined native-cadence ball evidence

`scripts/replay/combined_ball_evidence.py` reuses stationary anchors,
template matching, optical flow, stable position changes and compact
trajectories. It decodes each candidate window once at its native
timestamps and leaves the replay and index files intact.

```sh
python3 scripts/replay/combined_ball_evidence.py REVIEW_FOLDER MANUAL_REVIEW.json /tmp/pule-combined-evidence.json
```

On the existing 47 labels, template matching or optical flow supported ten
genuine shots, with zero false confirmations. Requiring a stable position
change and a trajectory recovered one additional genuine shot. Exploratory
checks at the midpoint and three-quarter mark recovered one more. The
conservative index filter retained all 23 genuine shots and the uncertain
detection and flagged five false positives. This is a single-recording
result. The signals use the same frames and are not statistically
independent. The full run covered 5,481 native frames in 35.6 seconds,
including 23.5 seconds of recognition, tracking and motion analysis.

The break stayed unconfirmed. A fast cue ball blurred and moved out of the
short-range search, and the rack fragmented after contact. A compact
trajectory was present, but none of the position comparisons passed the
stability and coverage checks. The manual cue-ball reposition in candidate
3 also produced trajectory evidence, so compact motion alone cannot
establish a cue strike. Keep these signals as review aids and preserve
ambiguous candidates.

### Local fixed-position ball vacancy benchmark

`scripts/replay/fixed_ball_vacancy.py` checks the fixed 7 × 7 centres of
automatic stationary anchors. The original break-test rule stays at 85%
felt-like pixels across four consecutive visible native frames. A nearby
reference is chosen from the same two patch offsets using the existing
cyan felt checks. The experiment uses no displaced-ball search or tracking.

```sh
python3 scripts/replay/fixed_ball_vacancy.py REVIEW_FOLDER MANUAL_REVIEW.json /tmp/pule-vacancy-benchmark
```

The 47-candidate run flagged vacancy in nine of 23 genuine shots, none of
23 false positives and the one uncertain candidate. A visual check showed
glare on candidate 16 and a questionable starting anchor on candidate 37.
Keep the uncertain label and distinguish automated rule matches from
visually verified ball movement. The automatic break check had only a rail
feature as an anchor, so it could not reproduce the manually seeded result.
This does not establish resistance to manual repositioning. In the
repositioning example the automatic recognizer did not seed the moved ball.
The 5,481-frame run took 13.2 seconds including review images. No replay
media or clip boundaries were changed.

### Frozen shot classification and validation

This concludes the local shot detection research phase. The frozen classifier
in `scripts/replay/frozen_vacancy_filter.py` runs alongside the normal replay
engine in the isolated local review workflow. It classifies the original
motion candidates without changing replay generation, raw motion timestamps,
or the padded source and replay boundaries.

- Rank perspective-scaled contrast proposals using the calibrated table and
  median pre-shot image. Keep the top 16 stationary ball proposals.
- Check a fixed 7 × 7 patch at each proposed position against the original
  stationary reference. Look for at least 25% of the original non-felt
  footprint, with a minimum of eight newly exposed pixels, at the same
  positions for four consecutive visible native frames. Use the existing
  shadow-tolerant felt comparison. A visibility failure resets the run.
- Measure LAB change on the first qualifying vacancy run for each patch.
  The same patch must meet both ΔL* ≥ 14.8346 and Δab ≥ 8.2540. A candidate
  passes when any qualifying patch meets both cutoffs.

For validation, reviewers labelled all original candidates, including filter
rejections, and reviewed the full source for missed shots. The local picker
records the original file's SHA-256 and blocks both known encodings of the
reference recording. This check distinguishes file bytes. An independent
validation also requires a different pool frame.

| Review | Candidates | Original precision / recall | Filter precision / recall | Genuine retained | False positives removed | Genuine rejected | Filter overhead |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Repeat review of `sean_double_compressed.mp4` | 48 | 50.0% / 100% | 90.0% / 75.0% | 18/24 | 22/24 | 6 | 16.4 s |
| Independent frame `PXL_20261025_205329617.mp4` | 33 | 42.4% / 100% | 84.6% / 78.6% | 11/14 | 17/19 | 3 | 19.8 s |

The repeat review used the same source bytes as the exploratory work and
provides no independent accuracy estimate. The independent file hash was
`7e2e3e88f05f5eb7b40e1e62d686d711377501e7b8d3f3511efeae46ea5c0f97`.
The reviewer reported no original detector misses or uncertain labels in
either review. Both filters retained two false positives. On the independent
frame the classifier rejected genuine candidates 7, 19 and 29. These results
describe one independent recording.

The classifier can miss genuine shots when the moving ball is poorly seeded,
occluded, near a rail shadow, or moves too little to expose a sustained
patch. Manual cue-ball repositioning can leave a real vacancy and pass both
LAB checks. Local glare and other imaging changes can also create false
evidence. Use the classifier to assign confidence and preserve candidates
for review. See [Pule Shots in the product plan](PRODUCT_PLAN.md#pule-shots).


### Phase 1 shot index and review state

The worker captures the original motion candidates before padding merges
them, maps each padded interval to the actual rendered video timestamps,
and applies the frozen classifier above. A candidate is stored as `high`
or `possible`. Possible shots remain available for future review. The index
uses source frame ordinals and a source SHA-256 to carry decisions across
rerenders of the same source. A different upload or changed detector
boundaries can create different candidate identities. The full replay keeps
the existing detector, padding, render settings, and original-source cleanup.

The [local migration](../supabase/migrations/202611270001_frame_replay_shots.sql)
adds private candidate and review tables and uses the existing replay
publication transaction. The index can be empty for older replays or when
source and render timestamps cannot be mapped safely. An unobservable
candidate remains possible. The worker keeps classification within the
existing processing budget and bounds native-frame buffering. Apply the
migration before rolling out the worker so indexed publication is available.

Read access follows full-replay visibility. Linked frame participants can
accept, reject, restore, edit, and reset candidate bounds. A review revision
guards against stale writes and supports immediate undo. A rejected shot is
omitted from the active index used by future playback, review, favourites,
highlights, and statistics. The review survives replay removal while the
frame exists. Edits are stored separately in source time and remapped into
the published segment. If a rerender cannot accommodate an edit, the
original padded bounds are shown and the stored edit is marked for review.

#### Footage available for boundary edits

After cleanup, a shot can be extended only as far as the contiguous retained
segment around it. An isolated candidate already uses the whole segment
created by its lead-in and tail, so it has no extra footage at either edge.
Candidates within a merged segment may have extra context on either side.
Adjacent rendered segments may be contiguous in playback while separated by
a gap in source time. Trims and extensions must stay in the same segment.
The index records those limits and uses the existing replay for playback or
on-demand exports, so individual shots require no extra stored videos.

Start with those available bounds. If user review shows isolated shots need
more context, measure the storage cost of adding short, bounded handles to
the merged segments in the single replay. This would require a separate
decision about replay padding. Keep current padding and retention for Phase 1.
