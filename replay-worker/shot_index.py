"""Frozen local vacancy and LAB classifier, and timing from rendered replay segments."""
from bisect import bisect_left
import argparse
import json
from pathlib import Path
import re
import subprocess

import cv2
import numpy as np

from replay_processor import LEAD_IN, TAIL

MAX_WINDOW_BYTES = 128 * 1024 * 1024


def geometry(corners, scale):
    corners = corners * scale
    x, y, w, h = cv2.boundingRect(corners.astype(np.float32))
    margin = round(18 * scale)
    crop = (x - margin, y - margin, w + 2 * margin, h + 2 * margin)
    local = corners - crop[:2]
    if np.linalg.norm(local[0] - local[1]) < np.linalg.norm(local[1] - local[2]):
        local = np.roll(local, -1, axis=0)
    transform = cv2.getPerspectiveTransform(
        local.astype("float32"),
        np.float32(
            [
                [0, 0],
                [479, 0],
                [479, 239],
                [0, 239],
            ]
        ),
    )
    polygon = np.zeros((crop[3], crop[2]), np.uint8)
    cv2.fillConvexPoly(polygon, local.astype(np.int32), 255)
    return crop, transform, polygon


RADIUS = 3
FELT_FRACTION = 0.85
CONSECUTIVE = 4


def roi(frame, x, y):
    return frame[y - RADIUS : y + RADIUS + 1, x - RADIUS : x + RADIUS + 1]


def chroma(v):
    return v / np.maximum(v.sum(axis=-1, keepdims=True), 1)


def felt_pixels(patch):
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    b, g, r = np.moveaxis(patch.astype(np.int16), 2, 0)
    return (
        (b - r >= 24)
        & (g - r >= 20)
        & (hsv[:, :, 2] >= 67)
        & (hsv[:, :, 0] >= 75)
        & (hsv[:, :, 0] <= 111)
    )


def reference(frame, polygon, x, y):
    # The same two offsets as the break check. Prefer the patch below when it
    # is entirely on the calibrated surface and shows visible cyan cloth.
    for dx, dy in ((0, 10), (-18, 1)):
        px, py = x + dx, y + dy
        if not (
            RADIUS <= px < frame.shape[1] - RADIUS
            and RADIUS <= py < frame.shape[0] - RADIUS
        ):
            continue
        patch = roi(frame, px, py)
        if (
            np.all(roi(polygon, px, py))
            and np.mean(felt_pixels(patch)) >= FELT_FRACTION
        ):
            return px, py, np.median(patch.reshape(-1, 3), axis=0)
    return None


def decode_native(source, crop, first, last):
    x, y, w, h = crop
    frame_limit = MAX_WINDOW_BYTES // (w * h * 3)
    if frame_limit < 4:
        raise ValueError("Table crop exceeds the shot analysis memory budget")
    process = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "info",
            "-ss",
            str(first),
            "-copyts",
            "-i",
            str(source),
            "-to",
            str(last),
            "-vf",
            f"crop={w}:{h}:{x}:{y}:exact=1,showinfo",
            "-fps_mode",
            "passthrough",
            "-an",
            "-frames:v",
            str(frame_limit + 1),
            "-pix_fmt",
            "bgr24",
            "-f",
            "rawvideo",
            "-",
        ],
        capture_output=True,
        check=True,
    )
    if len(process.stdout) > frame_limit * w * h * 3:
        raise ValueError("Shot window exceeds the analysis memory budget")
    frames = np.frombuffer(process.stdout, dtype=np.uint8).reshape(-1, h, w, 3)
    times = [float(v) for v in re.findall(rb"\bpts_time:([\d.]+)", process.stderr)][
        : len(frames)
    ]
    if (
        len(times) != len(frames)
        or not times
        or any(b <= a for a, b in zip(times, times[1:]))
    ):
        raise RuntimeError(f"Cannot align decoded frame timestamps for {source.name}.")
    return frames, times


def expected_radius(crop, H, poly):
    w, h = crop[2:]
    yy, xx = np.indices((h, w), dtype=np.float32)
    # Local horizontal perspective scale: approximate pixel diameter anchored to
    # the previously measured 9–16 px span, without fitting individual marks.
    inv = np.linalg.inv(H)
    v = np.float32(np.stack((xx, yy), axis=-1).reshape(-1, 1, 2))
    table = cv2.perspectiveTransform(v, H)
    step = table + np.float32([1, 0])
    scale = np.linalg.norm(cv2.perspectiveTransform(step, inv) - v, axis=2).reshape(
        h, w
    )
    valid = poly != 0
    lo, hi = np.quantile(scale[valid], [0.05, 0.95])
    radius = 4.5 + 3.5 * np.clip((scale - lo) / (hi - lo), 0, 1)
    distance = cv2.distanceTransform(poly, cv2.DIST_L2, 5)
    # Treat the projected bottom of the ball as its contact with the cloth.
    yfoot = np.minimum(h - 1, (yy + radius * 0.65).astype(int))
    inside = distance[yfoot, xx.astype(int)] >= np.maximum(2, radius * 0.38)
    return radius, inside


def propose(frames, radius, inside):
    h, w = inside.shape
    image = np.median(frames, axis=0).astype("uint8")
    f = image.astype(np.float32)
    intensity = f.mean(axis=2)
    chroma = f / np.maximum(f.sum(axis=2, keepdims=True), 1)
    # Felt is relatively deficient in red. Remove the smooth local background
    # so that shadowing shared by the centre and its surround contributes less.
    color = chroma[:, :, 2] * 240
    scores = []
    for r in (4, 5, 6, 7, 8):
        values = []
        for ch in (intensity, color):
            small = cv2.GaussianBlur(ch, (0, 0), r * 0.38)
            large = cv2.GaussianBlur(ch, (0, 0), r * 0.95)
            values.append(small - large)
        strength = np.hypot(values[0], values[1] * 1.4)
        strength *= np.exp(-(((radius - r) / 2.2) ** 2))
        scores.append(strength)
    score = np.max(scores, axis=0)
    size = np.argmax(scores, axis=0) + 4
    maxima = (
        (score == cv2.dilate(score, np.ones((5, 5), np.uint8))) & inside & (score >= 9)
    )
    options = []
    for y, x in zip(*np.where(maxima)):
        r = int(size[y, x])
        theta = np.linspace(0, 2 * np.pi, 16, endpoint=False)
        xi = np.rint(x + r * 1.35 * np.cos(theta)).astype(int)
        yi = np.rint(y + r * 1.35 * np.sin(theta)).astype(int)
        if min(xi) < 0 or max(xi) >= w or min(yi) < 0 or max(yi) >= h:
            continue
        delta = np.linalg.norm(chroma[yi, xi] - chroma[y, x], axis=1)
        lum = np.abs(intensity[yi, xi] - intensity[y, x])
        # Demand contrast in several directions, rejecting a straight rail edge.
        support = (delta > 0.064) | (lum > 24)
        if sum(support) < 9 or sum(support & np.roll(support, 8)) < 4:
            continue
        local = np.max(np.abs(frames[:, y, x].astype(float) - image[y, x]), axis=1)
        if np.mean(local <= 24) < 0.7:
            continue
        options.append((float(score[y, x]), int(x), int(y), r))
    out = []
    for s, x, y, r in sorted(options, reverse=True):
        if all(np.hypot(x - u, y - v) >= 0.80 * (r + q) for _, u, v, q in out):
            out.append((s, x, y, r))
    return image, out


MIN_LIGHTNESS = 14.8346
MIN_CHROMA = 8.2540
PROPOSALS = 16


def felt_mask(frame, x, y, ref):
    px, py, baseline = ref
    local = np.median(roi(frame, px, py).reshape(-1, 3), axis=0)
    if (
        local.sum() < 0.55 * baseline.sum()
        or np.max(abs(chroma(local) - chroma(baseline))) > 0.065
    ):
        return None
    patch = roi(frame, x, y).astype(float)
    ratio = patch.sum(axis=2) / local.sum()
    return (
        (np.max(abs(chroma(patch) - chroma(local)), axis=2) <= 0.055)
        & (ratio >= 0.30)
        & (ratio <= 1.40)
    )


def lab_delta(before, after):
    def lab(image):
        return cv2.cvtColor(image.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)

    diff = np.median([lab(frame) for frame in after], axis=0) - lab(before)
    return float(np.median(abs(diff[:, :, 0]))), float(
        np.median(np.linalg.norm(diff[:, :, 1:], axis=2))
    )


def qualifying_patches(frames, polygon, points, initial, first):
    for x, y in points:
        patch = roi(frames[initial], x, y)
        ref = reference(frames[initial], polygon, x, y)
        if patch.shape[:2] != (7, 7) or ref is None:
            continue
        start = felt_mask(frames[initial], x, y, ref)
        if start is None or start.mean() >= FELT_FRACTION:
            continue
        footprint = ~start
        minimum = max(8, int(np.ceil(0.25 * footprint.sum())))
        chain = []
        for i in range(first, len(frames)):
            current = felt_mask(frames[i], x, y, ref)
            chain = (
                (chain + [current & footprint])[-CONSECUTIVE:]
                if current is not None
                else []
            )
            if (
                len(chain) != CONSECUTIVE
                or np.logical_and.reduce(chain).sum() < minimum
            ):
                continue
            lightness, chromatic = lab_delta(
                patch, [roi(f, x, y) for f in frames[i - CONSECUTIVE + 1 : i + 1]]
            )
            yield lightness >= MIN_LIGHTNESS and chromatic >= MIN_CHROMA
            # The calibration data used the first qualifying vacancy run per patch.
            break


def packet_timing(path, *, bound_to_container=False):
    """Read the MP4 video timeline without decoding a second full video pass."""
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "packet=pts_time,duration_time,flags:format=duration",
            "-of",
            "json",
            str(path),
        ]
    )
    timing = json.loads(raw)
    # MP4 edit lists can include decoder preroll that is never presented.
    samples = sorted(
        (float(p["pts_time"]), float(p.get("duration_time", 0)))
        for p in timing["packets"]
        if "D" not in p.get("flags", "")
    )
    times = [pts for pts, _ in samples]
    if (
        not times
        or any(b <= a for a, b in zip(times, times[1:]))
        or samples[-1][1] <= 0
    ):
        raise ValueError("Cannot map unordered or incomplete video timestamps")
    end = sum(samples[-1])
    if bound_to_container:
        end = min(end, float(timing["format"]["duration"]))
    return times, end


def classify(source, crop, polygon, radius, inside, onset, end):
    frames, times = decode_native(source, crop, max(0, onset - 0.95), end + 0.65)
    initial = min(bisect_left(times, onset - 0.25), len(times) - 1)
    stack = frames[bisect_left(times, times[initial] - 0.55) : initial + 1]
    _, ranked = propose(stack, radius, inside)
    points = [(x, y) for _, x, y, _ in ranked[:PROPOSALS]]
    return any(
        qualifying_patches(
            frames,
            polygon,
            points,
            initial,
            max(initial + 1, bisect_left(times, onset)),
        )
    )


def build_index(source, corners, replay, segments, motion, save_candidates):
    source_pts, source_end = packet_timing(source)
    if len(source_pts) != motion["frame_count"] or abs(source_pts[0]) > 0.001:
        raise ValueError("Source timestamps do not match decoded detector frames")

    def source_time(frame):
        return source_pts[frame] if frame < len(source_pts) else source_end

    final_pts, final_end = packet_timing(replay, bound_to_container=True)
    offset = 0
    shots = []
    classification_times = []
    for number, (clip_start, clip_end) in enumerate(motion["clips"], 1):
        pts, segment_end = packet_timing(segments / f"shot_{number:03d}.mp4")
        stop = offset + len(pts)
        finished = final_pts[offset:stop]
        if len(finished) != len(pts) or any(
            abs((a - finished[0]) - (b - pts[0])) > 0.002 for a, b in zip(finished, pts)
        ):
            raise ValueError("Rendered video timestamps do not match segment samples")
        replay_end = min(final_end, finished[-1] + segment_end - pts[-1])
        if stop < len(final_pts):
            replay_end = min(replay_end, final_pts[stop])

        def replay_time(source_seconds):
            at = bisect_left(pts, source_seconds - clip_start + pts[0] - 1e-6)
            return replay_end if at == len(pts) else finished[at]

        for start, end in motion["shots"]:
            padded_start = max(0.0, start - LEAD_IN)
            padded_end = min(motion["duration"], end + TAIL)
            if not clip_start <= padded_start < padded_end <= clip_end:
                continue
            start_frame = round(start * motion["fps"])
            end_frame = min(len(source_pts), round(end * motion["fps"]))
            classification_times.append(
                (source_time(start_frame), source_time(end_frame))
            )
            shots.append(
                {
                    "candidate_key": f"{start_frame}:{end_frame}",
                    "shot_number": len(shots) + 1,
                    "motion_start_ms": round(1000 * source_time(start_frame)),
                    "motion_end_ms": round(1000 * source_time(end_frame)),
                    "source_start_ms": round(1000 * padded_start),
                    "source_end_ms": round(1000 * padded_end),
                    "replay_start_ms": round(1000 * replay_time(padded_start)),
                    "replay_end_ms": round(1000 * replay_time(padded_end)),
                    "segment_source_start_ms": round(1000 * clip_start),
                    "segment_source_end_ms": round(1000 * clip_end),
                    "segment_replay_start_ms": round(1000 * finished[0]),
                    "segment_replay_end_ms": round(1000 * replay_end),
                    "confidence": "possible",
                }
            )
        offset = stop
    if offset != len(final_pts) or len(shots) != len(motion["shots"]):
        raise ValueError("Some rendered samples or candidates were not mapped")
    save_candidates(shots)
    try:
        crop, plane, polygon = geometry(np.load(corners), 1)
        if crop[2] * crop[3] > 4_000_000:
            return shots
        radius, inside = expected_radius(crop, plane, polygon)
    except (ValueError, cv2.error, np.linalg.LinAlgError):
        return shots
    for shot, (start, end) in zip(shots, classification_times):
        try:
            if classify(source, crop, polygon, radius, inside, start, end):
                shot["confidence"] = "high"
        except (ValueError, RuntimeError, cv2.error, subprocess.CalledProcessError):
            # A missing observation is still a candidate. The replay is independent.
            pass
    return shots


def main():
    parser = argparse.ArgumentParser()
    for name in ("source", "corners", "replay", "segments", "motion", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cv2.setNumThreads(1)

    def save_candidates(shots):
        pending = args.output.with_suffix(".pending")
        pending.write_text(json.dumps(shots))
        pending.replace(args.output)

    result = build_index(
        args.source,
        args.corners,
        args.replay,
        args.segments,
        json.loads(args.motion.read_text()),
        save_candidates,
    )
    save_candidates(result)


if __name__ == "__main__":
    main()
