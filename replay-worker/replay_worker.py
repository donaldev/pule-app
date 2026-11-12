"""Trusted one-job Stage 1 worker. SQL leases own paths, publication and cleanup.

No caller-supplied URLs/job JSON. Credentials stay in the server environment.
The supplied replay_processor.py detector/renderer is invoked unchanged.
"""
from __future__ import annotations

import argparse
import csv
import http.client
import json
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse, quote

import cv2
import numpy as np
from r2_source import R2Source, MAX_SOURCE_BYTES

MAX_BYTES = 262144000
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
KEY_RE = re.compile(rf'^{UUID}/{UUID}/{UUID}\.mp4$')


class SupabaseAPI:
    """HTTPS only, no redirects, streamed file bodies and bounded JSON responses."""
    def __init__(self, base: str, secret: str):
        parsed = urlparse(base)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
            raise ValueError('Expected a plain HTTPS Supabase project endpoint')
        if not secret:
            raise ValueError('Missing worker credential')
        self.host, self.port, self.secret = parsed.hostname, parsed.port, secret

    def _request(self, method, path, body=None, content_type=None, length=None):
        conn = http.client.HTTPSConnection(self.host, self.port, timeout=90)
        headers = {'Authorization': f'Bearer {self.secret}', 'apikey': self.secret,
                   'Accept-Profile': 'app', 'Content-Profile': 'app', 'x-upsert': 'false'}
        if content_type:
            headers['Content-Type'] = content_type
        if length is not None:
            headers['Content-Length'] = str(length)
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            if response.status not in (200, 201, 204):
                raise RuntimeError('Trusted Storage/RPC request failed')
            return conn, response
        except Exception:
            conn.close()
            raise

    def rpc(self, name, args):
        if not re.fullmatch(r'[a-z][a-z0-9_]*', name):
            raise ValueError('Invalid RPC name')
        body = json.dumps(args).encode()
        conn, response = self._request('POST', '/rest/v1/rpc/' + name, body, 'application/json', len(body))
        try:
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError('Oversized RPC response')
            return json.loads(data) if data else None
        finally:
            conn.close()

    def download(self, key, target, expected):
        conn, response = self._request('GET', '/storage/v1/object/authenticated/frame-recordings/' + quote(key, safe='/'))
        try:
            size = 0
            deadline = time.monotonic() + 300
            with target.open('wb') as out:
                while chunk := response.read(1024 * 1024):
                    if time.monotonic() > deadline:
                        raise ValueError('Source download time limit exceeded')
                    size += len(chunk)
                    if size > expected or size > MAX_BYTES:
                        raise ValueError('Source size exceeds reservation')
                    out.write(chunk)
            if size != expected or size == 0:
                raise ValueError('Source length does not match reservation')
        finally:
            conn.close()

    def upload(self, key, path):
        with path.open('rb') as body:
            conn, response = self._request('POST', '/storage/v1/object/frame-replays/' + quote(key, safe='/'),
                                           body, 'video/mp4', path.stat().st_size)
            try:
                response.read(4096)
            finally:
                conn.close()


def validate_job(job):
    r2 = job.get('source_provider', 'supabase') == 'r2'
    if job.get('source_provider', 'supabase') not in ('supabase', 'r2'):
        raise ValueError('Invalid source provider')
    if r2 and (not re.fullmatch(r'[a-f0-9]{64}', str(job.get('source_sha256', ''))) or not isinstance(job.get('source_etag'), str) or not 1 <= len(job['source_etag']) <= 128):
        raise ValueError('Invalid R2 source evidence')
    if (not re.fullmatch(UUID, str(job.get('job_id', '')))
            or not re.fullmatch(UUID, str(job.get('lease_id', '')))
            or job.get('source_bucket') != ('pule-frame-recordings' if r2 else 'frame-recordings') or job.get('destination_bucket') != 'frame-replays'
            or not KEY_RE.fullmatch(str(job.get('source_key', '')))
            or not KEY_RE.fullmatch(str(job.get('destination_key', '')))):
        raise ValueError('Invalid trusted job identity')
    if (job['source_key'].rsplit('/', 1)[0] != job['destination_key'].rsplit('/', 1)[0]
            or job['source_key'].rsplit('/', 1)[1] != job['job_id'] + '.mp4'
            or job['destination_key'].rsplit('/', 1)[1] != job['lease_id'] + '.mp4'):
        raise ValueError('Job paths do not match the lease')
    if type(job.get('expected_bytes')) is not int or not 1 <= job['expected_bytes'] <= (MAX_SOURCE_BYTES if r2 else MAX_BYTES):
        raise ValueError('Invalid source size')


def validate_corners(source, job):
    corners = np.asarray(job.get('table_corners'), dtype=np.float32)
    cap = cv2.VideoCapture(str(source))
    try:
        if not cap.isOpened():
            raise ValueError('Cannot decode source recording')
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if (w != job['source_width'] or h != job['source_height'] or not 16 <= w <= 8192
                or not 16 <= h <= 8192 or w * h > 33554432 or not math.isfinite(fps)
                or not math.isfinite(count) or fps <= 0 or count <= 0 or count / fps > 7200):
            raise ValueError('Source dimensions or duration do not match the job limits')
        if (corners.shape != (4, 2) or not np.isfinite(corners).all() or (corners < 0).any()
                or (corners[:, 0] >= w).any() or (corners[:, 1] >= h).any()
                or not cv2.isContourConvex(corners) or abs(cv2.contourArea(corners)) < 100):
            raise ValueError('Expected four cyclic convex corners inside the original recording')
        _, _, bw, bh = cv2.boundingRect(corners)
        if (bh + 80) * 1440 / (bw + 80) > 4096:
            raise ValueError('Table crop exceeds processor memory limit')
        return corners
    finally:
        cap.release()


def prepare_analysis_source(source, work):
    """Use raw encoded pixels consistently across OpenCV backends. No re-encoding.

    Browser corners invert the MP4 display matrix. Strip that matrix for analysis,
    then restore it on the generated replay so playback retains phone orientation.
    """
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                            '-show_entries', 'stream_side_data=rotation', '-of', 'json', str(source)],
                           check=True, capture_output=True, text=True, timeout=30)
    streams = json.loads(probe.stdout).get('streams', [])
    rotations = [item['rotation'] for stream in streams for item in stream.get('side_data_list', []) if 'rotation' in item]
    angle = float(rotations[0]) if rotations else 0
    if not math.isfinite(angle) or angle % 90 != 0:
        raise ValueError('Unsupported source rotation')
    angle = int(angle) % 360
    analysis = work / 'analysis.mp4'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-display_rotation:v:0', '0', '-noautorotate', '-i', str(source),
                    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', str(analysis)],
                   check=True, capture_output=True, timeout=90)
    return analysis, angle


def process_recording(source, job, work):
    source, rotation = prepare_analysis_source(source, work)
    corners = validate_corners(source, job)
    corner_path, output = work / 'corners.npy', work / 'replay.mp4'
    np.save(corner_path, corners)
    command = [sys.executable, str(Path(__file__).with_name('replay_processor.py')),
               '--input', str(source), '--corners', str(corner_path), '--output', str(output),
               '--workdir', str(work / 'detector')]
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        child.communicate(timeout=1200)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.communicate()
        raise ValueError('Processor time limit exceeded') from None
    if child.returncode:
        raise ValueError('Processor did not generate a replay')
    with (work / 'detector' / 'candidate_clips.csv').open() as manifest:
        clips = list(csv.DictReader(manifest))
    if not 1 <= len(clips) <= 1000:
        raise ValueError('Invalid generated clip count')
    if rotation:
        oriented = work / 'oriented-replay.mp4'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-display_rotation:v:0', str(rotation), '-noautorotate', '-i', str(output), '-c', 'copy', str(oriented)],
                       check=True, capture_output=True, timeout=90)
        oriented.replace(output)
    verified = verify_video(output)
    return output, {**verified, 'clip_count': len(clips)}


def verify_video(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                             'format=duration:stream=codec_type,codec_name', '-of', 'json', str(path)],
                            check=True, capture_output=True, text=True, timeout=30)
    data = json.loads(result.stdout)
    duration = float(data.get('format', {}).get('duration', 0))
    size = path.stat().st_size
    if (not math.isfinite(duration) or not 0 < duration <= 7200 or not 0 < size <= MAX_BYTES
            or not any(s.get('codec_type') == 'video' and s.get('codec_name') == 'h264' for s in data.get('streams', []))):
        raise ValueError('Output must be a bounded H.264 MP4 replay')
    return {'duration_seconds': duration, 'size_bytes': size}


def run_once(api, processor=process_recording, r2=None):
    try:
        job = api.rpc('claim_r2_frame_replay_processing', {}) if r2 is not None else None
        if job is None:
            job = api.rpc('claim_frame_replay_processing', {})
    except ValueError as exc:
        print(json.dumps({
            'status': 'claim_failed',
            'reason': str(exc)
        }))
        raise
    if job is None:
        return {'status': 'idle'}
    # Validate before any Storage request; malformed trusted jobs lose their lease.
    try:
        validate_job(job)
    except ValueError as exc:
        print(json.dumps({
        'status': 'invalid_job',
        'reason': str(exc)
        }))
        raise
    args = {'p_upload': job['job_id'], 'p_lease': job['lease_id']}
    try:
        with tempfile.TemporaryDirectory(prefix='pule-replay-') as tmp:
            work = Path(tmp)
            source = work / 'source.mp4'
            if job.get('source_provider') == 'r2':
                if r2 is None:
                    raise ValueError('R2 source reader required')
                r2.download(job, source)
            else:
                api.download(job['source_key'], source, job['expected_bytes'])
            output, result = processor(source, job, work)
            # Recheck the artifact immediately before trusted upload/publication.
            actual = verify_video(output)
            if actual['size_bytes'] != result['size_bytes']:
                raise ValueError('Output changed after verification')
            api.upload(job['destination_key'], output)
            api.rpc('complete_frame_replay_processing', {**args, 'p_bytes': actual['size_bytes'],
                    'p_duration': actual['duration_seconds'], 'p_clips': result['clip_count']})
            # SQL queues source deletion atomically with publication. Never delete here.
            return {'job_id': job['job_id'], 'status': 'completed'}
    except Exception as exc:
        print(json.dumps({
            'status': 'processing_error',
            'error_type': type(exc).__name__,
            'reason': str(exc)[:300]
        }))
        try:
            api.rpc('fail_frame_replay_processing', args)
            return {'job_id': job['job_id'], 'status': 'failed'}
        except Exception:
            # Completion may have committed despite a lost response. Do not delete
            # or mark completed artifacts failed locally; SQL/leases own recovery.
            return {'job_id': job['job_id'], 'status': 'unconfirmed'}


def verify_toolchain():
    """Fail before leasing work if the installed tools cannot preserve orientation."""
    help_result = subprocess.run(['ffmpeg', '-hide_banner', '-h', 'full'], check=True,
                                 capture_output=True, text=True, timeout=10)
    if '-display_rotation' not in help_result.stdout + help_result.stderr:
        raise ValueError('FFmpeg 6+ with display_rotation is required')
    subprocess.run(['ffprobe', '-version'], check=True, capture_output=True, timeout=10)


def main():
    parser = argparse.ArgumentParser(description='Claim and process one trusted Pule replay job')
    parser.add_argument('--check', action='store_true', help='Validate local dependencies only; never claim or contact Supabase')
    args = parser.parse_args()
    stage = 'verify_toolchain'
    try:
        verify_toolchain()
        if args.check:
            print(json.dumps({'status': 'toolchain_ready'}))
            return

        stage = 'initialize_r2'
        r2 = R2Source() if os.environ.get('R2_ACCOUNT_ID') else None

        stage = 'claim_and_process'
        result = run_once(
            SupabaseAPI(
                os.environ['SUPABASE_URL'],
                os.environ['SUPABASE_SERVICE_ROLE_KEY']
            ),
            r2=r2
        )
        print(json.dumps(result))
        if result['status'] in ('failed', 'unconfirmed'):
            raise SystemExit(1)

    except Exception as exc:
        print(json.dumps({
            'status': 'worker_failed',
            'error_type': type(exc).__name__,
            'error_stage': stage
        }))
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
