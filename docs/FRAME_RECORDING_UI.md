# Mobile full-frame recording uploads — local implementation

Enable `VITE_FRAME_RECORDING_UPLOADS=true` only after migrations through
`202611100004_replay_cleanup_accounting.sql` via the
[audited atomic rollout](FRAME_REPLAY_DEPLOYMENT_AUDIT.md), private bucket limits and BOTH processing
and cleanup workers are ready. The example/default is false, preserving production
Watch Replay while uploads are undeployed. No migrations or historical data were
changed by this UI task. No remote upload, migration or deployment was performed.

## Flow

Connected SessionView Frame History retains Watch Replay for registered metadata.
For other frames, the optional upload/status action requires ready replay metadata,
a linked participating player, completed status, and eligible frame/session detail.
The backend remains the authority; viewing a group is not upload authorization.

1. Choose one complete, stationary-camera MP4 frame recording (at most 250 MiB,
   two hours, supported backend resolution). MOV must first be exported as MP4.
   Unsupported codecs/transforms or a browser that cannot decode the preview fail
   before any reservation. Smaller configured bucket limits still apply server-side.
2. Play/seek to a clear view, pause and choose **Use this view to mark corners**.
   Tap the four table corners cyclically. Undo/reset and numeric coordinate fields
   allow correction. Keyboard users can add a center point then edit its coordinates.
   No table or shots are detected in the browser.
3. **Upload full frame** persists an actor/project/frame-scoped journal and original
   operation UUID before calling the existing reservation RPC. A full-file streaming
   SHA-256 binds resume to the exact original bytes, without loading the entire file
   into memory. Nothing goes through scoring RPCs or the scoring recovery queue.
4. TUS sends six-MiB chunks to the private `frame-recordings` bucket using the caller's
   JWT and exact server path; no upsert. Progress is visible. Pause/close/unmount or
   account changes stop transfer. No automatic retries, background sync or polling.
   After browser/PWA suspension, explicitly reopen the SAME file and resume.
5. Source finalization uses the saved upload UUID and never publishes the recording.
   **Create replay** submits the selected corners through the existing actor-only
   queue RPC. **Check status** reads uploaded/queued/processing/completed/failed
   state explicitly. Completed checks refresh replay metadata to reveal Watch Replay.
   Failure permits corrected corners and explicit retry within backend limits.

Browser recovery uses localStorage plus Web Locks to coordinate tabs (current Safari
or Chrome in a secure context). Unavailable/malformed storage or unavailable locks
block upload writes rather than silently fabricate a new request. Active journals
cannot be replaced by another tab's operation. Unknown reservation acknowledgments
use **Recover saved reservation**, which explicitly repeats the SAME idempotent
reservation; known upload IDs use the read-only status RPC. Unknown finalization or
queue responses retain the original request/corners. **Confirm finished upload**
reconciles an already-stored source through the idempotent finalizer without
reuploading bytes when a transfer-success acknowledgment/local marker was lost. Expired confirmed reservations
can be cleared explicitly; server cleanup/quota constraints still apply. Clearing
browser data or switching devices loses local recovery discovery: the current backend
has no per-frame upload-list RPC. Use the original browser/device while its reservation
or processing attempt remains active. No source video, credential, or signed playback
URL is persisted in the upload journal.

## Coordinate and orientation contract

The selector draws the local video in its browser-displayed orientation. A bounded
MP4 metadata reader extracts the single video track's encoded dimensions and display
matrix, accepting ordinary square-pixel H.264/HEVC tracks with 0/90/180/270 degree
rotations. Mirroring, shear/scaling, perspective, clean aperture crops and non-square
pixels are rejected. Metadata reads are bounded to 16 MiB and skip media payloads.

The canvas and SVG have identical bounds; pointer positions use the current bounding
rectangle, so scrolling and responsive resizing do not change source coordinates.
Each tap maps from display coordinates to ORIGINAL encoded pixel centers by inverting
the MP4 rotation matrix. Queue requests send those points and the unrotated source
width/height. The original source file is uploaded unchanged. Browser intrinsic display
dimensions must match the parsed transform; unexpected orientation fails closed.

Deploy the **updated Python worker alongside this UI**: it uses lossless stream-copy
remuxing to remove source rotation metadata before calling the unchanged detector.
This makes its decoded pixels agree with the submitted encoded coordinates on every
OpenCV backend. The generated replay receives the original rotation metadata via
another lossless remux, so Watch Replay remains upright. FFmpeg must support
`-display_rotation` (6+); older workers that rely on OpenCV auto-rotation are not
compatible with rotated UI uploads. No thresholds, shot selection or historical
records are changed. Existing unrotated jobs retain the same coordinates.

## Checks and remaining device verification

Focused tests: `node --test scripts/frontend/recordingUpload.test.mjs` covers the
component upload/queue/failure states, gated availability, actor-bound RPCs, exact
file hashing, durable recovery, unsafe-backend rejection, TUS credentials/path/size,
pause/account switching, geometry and actual FFmpeg-produced display matrices at all
four rotations. Pixel comparisons use real decoded video, not assumed rotation signs.

`python -B -m unittest discover -s replay-worker/tests -v` in an environment with the
worker requirements and FFmpeg checks raw coordinate-space remuxing and real
moving-ball detection/rendering for all four rotations, output orientation, and
existing worker failure/recovery behavior. TypeScript/Vite build and ESLint are also
required. The supplied `replay_processor.py` is unchanged in this task.

Before enabling production uploads, test actual iOS Safari/PWA and Android Chrome:
file picking, HEVC support, portrait/landscape/180-degree capture, canvas orientation,
corner accuracy, upload interruption/reselection, screen locking, account switching,
processing, native replay playback and Storage cleanup. Local component/FFmpeg tests
do not establish those physical-device or live Supabase/TUS results. Video uploads
cannot be promised to continue while a mobile browser is suspended.

Local results: **66 selected frontend tests passed**, including **18 focused upload
tests**; **13 Python tests passed**, including the real detector/renderer and output
orientation at all four rotations. ESLint and TypeScript/Vite build passed. Browser
component tests use controlled hooks and mocked network calls; the MP4 geometry
tests use actual FFmpeg-produced matrices/pixel data. No live TUS transfer or
physical-device browser result is claimed.
