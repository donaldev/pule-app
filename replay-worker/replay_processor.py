"""Pule prototype replay pipeline, refactored as a configurable offline CLI."""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

# Preserve the proven prototype's default detector settings.
ANALYSIS_WIDTH = 1440
SAMPLE_FPS = 15
MIN_BLOB_AREA = 8
MAX_BLOB_AREA = 1200
PIXEL_THRESHOLD = 18
START_THRESHOLD = 1200
STOP_THRESHOLD = 650
MIN_ACTIVE_SECONDS = 0.13
SETTLE_SECONDS = 0.60
LEAD_IN = 2.0
TAIL = 0.5


def select_clips(times: np.ndarray, scores: np.ndarray, duration: float) -> list[tuple[float, float]]:
    if len(times) != len(scores) or len(times) == 0:
        raise ValueError('Motion times and scores must be nonempty and equal length')
    window = max(1, round(SAMPLE_FPS * 0.2))
    smoothed = np.convolve(scores, np.ones(window) / window, mode='same')
    shots = []
    active = False
    start = above_since = below_since = None
    for t, score in zip(times, smoothed):
        if not active:
            if score >= START_THRESHOLD:
                if above_since is None:
                    above_since = t
                if t - above_since >= MIN_ACTIVE_SECONDS:
                    start, active, below_since = above_since, True, None
            else:
                above_since = None
        else:
            if score < STOP_THRESHOLD:
                if below_since is None:
                    below_since = t
                if t - below_since >= SETTLE_SECONDS:
                    shots.append((start, below_since))
                    active, above_since, below_since = False, None, None
            else:
                below_since = None
    if active:
        shots.append((start, duration))
    clips = []
    for start, stop in shots:
        a, b = max(0.0, float(start) - LEAD_IN), min(duration, float(stop) + TAIL)
        if clips and a <= clips[-1][1]:
            clips[-1] = (clips[-1][0], max(clips[-1][1], b))
        else:
            clips.append((a, b))
    return clips


def detect_clips(video: Path, corners_file: Path) -> tuple[list[tuple[float, float]], float]:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open video: {video}')
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if fps <= 0 or frame_count <= 0:
            raise ValueError('Invalid video FPS or frame count')
        duration = frame_count / fps
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        corners = np.load(corners_file, allow_pickle=False).astype(np.float32)
        if corners.shape != (4, 2) or not np.isfinite(corners).all():
            raise ValueError('Table corners must be a finite (4, 2) array')
        x, y, w, h = cv2.boundingRect(corners.astype(np.int32))
        margin = 40
        x = max(0, x - margin)
        y = max(0, y - margin)
        w = min(width - x, w + 2 * margin)
        h = min(height - y, h + 2 * margin)
        if w <= 0 or h <= 0:
            raise ValueError('Table corners are outside video bounds')
        scale = ANALYSIS_WIDTH / w
        new_height = max(1, round(h * scale))
        polygon = ((corners - [x, y]) * scale).astype(np.int32)
        mask = np.zeros((new_height, ANALYSIS_WIDTH), dtype=np.uint8)
        cv2.fillPoly(mask, [polygon], 255)
        mask = cv2.erode(mask, np.ones((13, 13), np.uint8))
        if not np.any(mask):
            raise ValueError('Empty table mask')
        times, scores = [], []
        previous = None
        frame_index = 0
        frame_step = max(1, round(fps / SAMPLE_FPS))
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % frame_step:
                frame_index += 1
                continue
            t = frame_index / fps
            crop = frame[y:y+h, x:x+w]
            resized = cv2.resize(crop, (ANALYSIS_WIDTH, new_height))
            gray = cv2.GaussianBlur(cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY), (5, 5), 0)
            score = 0
            if previous is not None:
                difference = cv2.absdiff(previous, gray)
                median = int(np.median(difference[mask > 0]))
                difference = cv2.subtract(difference, np.full_like(difference, median))
                _, binary = cv2.threshold(difference, PIXEL_THRESHOLD, 255, cv2.THRESH_BINARY)
                binary = cv2.bitwise_and(binary, mask)
                count, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
                for i in range(1, count):
                    area = stats[i, cv2.CC_STAT_AREA]
                    if MIN_BLOB_AREA <= area <= MAX_BLOB_AREA:
                        score += int(area)
            times.append(t)
            scores.append(score)
            previous = gray
            frame_index += 1
        return select_clips(np.asarray(times), np.asarray(scores, dtype=float), duration), duration
    finally:
        cap.release()


def render_replay(video: Path, clips: list[tuple[float, float]], output: Path, workdir: Path) -> None:
    if not clips:
        raise ValueError('No candidate clips found; do not publish an empty replay')
    workdir.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    rendered = []
    for i, (start, end) in enumerate(clips, 1):
        if end <= start:
            raise ValueError('Invalid clip interval')
        clip = workdir / f'shot_{i:03d}.mp4'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.6f}', '-i', str(video),
                        '-t', f'{end - start:.6f}', '-vf', 'scale=-2:960', '-c:v', 'libx264',
                        '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-ar', '48000', '-ac', '2', str(clip)], check=True)
        rendered.append(clip)
    concat = workdir / 'concat.txt'
    # ffconcat supports safely escaped absolute filenames; workdir should be private/trusted.
    with concat.open('w') as f:
        for clip in rendered:
            escaped = str(clip.resolve()).replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
                    '-i', str(concat), '-c', 'copy', str(output)], check=True)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError('Replay output missing or empty')


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate a Pule replay from one full-frame recording')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--corners', type=Path, required=True, help='Table coordinates .npy from select_table.py')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workdir', type=Path, required=True)
    args = parser.parse_args()
    clips, duration = detect_clips(args.input, args.corners)
    args.workdir.mkdir(parents=True, exist_ok=True)
    with (args.workdir / 'candidate_clips.csv').open('w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['clip_number', 'clip_start', 'clip_end', 'duration'])
        for i, (start, end) in enumerate(clips, 1):
            writer.writerow([i, round(start, 2), round(end, 2), round(end-start, 2)])
    render_replay(args.input, clips, args.output, args.workdir)
    print(json.dumps({'status': 'completed', 'output': str(args.output),
                      'source_duration_seconds': round(duration, 2),
                      'replay_duration_seconds': round(sum(b-a for a, b in clips), 2),
                      'clip_count': len(clips)}))


if __name__ == '__main__':
    main()
