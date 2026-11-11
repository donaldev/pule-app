import sys
from pathlib import Path as _Path
sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from replay_worker import SupabaseAPI, validate_job, validate_corners, verify_video, run_once, process_recording

UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
LEASE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
PREFIX = '8926207a-9936-5762-a991-492b45ef7e50/366064c1-d7d3-5bf6-a17b-131fa5cf1fbb/'
JOB = {'job_id': UID, 'lease_id': LEASE, 'source_bucket': 'frame-recordings',
       'source_key': PREFIX + UID + '.mp4', 'expected_bytes': 100,
       'destination_bucket': 'frame-replays', 'destination_key': PREFIX + LEASE + '.mp4',
       'table_corners': [[20, 20], [620, 20], [620, 460], [20, 460]], 'source_width': 640, 'source_height': 480}


def video(path):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=640x480:r=15',
                    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)], check=True, capture_output=True)


class FakeAPI:
    def __init__(self, fail=None):
        self.calls, self.fail = [], fail

    def rpc(self, name, args):
        self.calls.append((name, args))
        if name == 'claim_frame_replay_processing':
            return dict(JOB)
        if self.fail == name or (self.fail == 'uncertain' and name in ('complete_frame_replay_processing', 'fail_frame_replay_processing')):
            raise RuntimeError('simulated failure')
        return {}

    def download(self, key, path, size):
        self.calls.append(('download', key))
        if self.fail == 'download':
            raise RuntimeError('simulated failure')
        path.write_bytes(b'source')

    def upload(self, key, path):
        self.calls.append(('upload', key))
        if self.fail == 'upload':
            raise RuntimeError('simulated failure')


class WorkerTests(unittest.TestCase):
    def test_endpoint_rejects_redirect_targets_and_credentials(self):
        for url in ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=x']:
            with self.assertRaises(ValueError):
                SupabaseAPI(url, 'secret')

    def test_paths_are_server_lease_bound(self):
        validate_job(JOB)
        for changed in [{'source_key': '../other'}, {'destination_key': PREFIX + UID + '.mp4'},
                        {'source_bucket': 'frame-replays'}, {'expected_bytes': 0}]:
            with self.assertRaises(ValueError):
                validate_job({**JOB, **changed})

    def test_publication_follows_verified_output_upload_and_never_deletes_source(self):
        api = FakeAPI()
        def processor(source, job, work):
            output = work / 'replay.mp4'
            output.write_bytes(b'replay')
            return output, {'size_bytes': 6, 'clip_count': 1}
        with patch('replay_worker.verify_video', return_value={'size_bytes': 6, 'duration_seconds': 1}):
            self.assertEqual(run_once(api, processor)['status'], 'completed')
        self.assertEqual([c[0] for c in api.calls], ['claim_frame_replay_processing', 'download', 'upload', 'complete_frame_replay_processing'])

    def test_failure_retains_source_and_reports_only_generic_failure(self):
        for failure in ['download', 'upload', 'complete_frame_replay_processing']:
            api = FakeAPI(failure)
            def processor(source, job, work):
                output = work / 'replay.mp4'
                output.write_bytes(b'replay')
                return output, {'size_bytes': 6, 'clip_count': 1}
            with patch('replay_worker.verify_video', return_value={'size_bytes': 6, 'duration_seconds': 1}):
                self.assertEqual(run_once(api, processor)['status'], 'failed')
            self.assertEqual(api.calls[-1][0], 'fail_frame_replay_processing')
            self.assertNotIn('delete', str(api.calls))

    def test_lost_publication_ack_does_not_delete_or_reupload(self):
        api = FakeAPI('uncertain')
        def processor(source, job, work):
            output = work / 'replay.mp4'
            output.write_bytes(b'replay')
            return output, {'size_bytes': 6, 'clip_count': 1}
        with patch('replay_worker.verify_video', return_value={'size_bytes': 6, 'duration_seconds': 1}):
            self.assertEqual(run_once(api, processor)['status'], 'unconfirmed')
        self.assertEqual(sum(c[0] == 'upload' for c in api.calls), 1)

    def test_actual_video_corner_bounds_dimensions_and_codec(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.mp4'
            video(path)
            self.assertEqual(validate_corners(path, JOB).shape, (4, 2))
            self.assertGreater(verify_video(path)['size_bytes'], 0)
            for changed in [{'source_width': 1280}, {'table_corners': [[0, 0], [640, 0], [640, 480], [0, 480]]},
                            {'table_corners': [[20, 20], [620, 460], [620, 20], [20, 460]]},
                            {'table_corners': [[20, 20]] * 4}]:
                with self.assertRaises(ValueError):
                    validate_corners(path, {**JOB, **changed})

    def test_supplied_processor_rejects_no_motion_without_publishing(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            source = work / 'source.mp4'
            video(source)
            with self.assertRaises(ValueError):
                process_recording(source, JOB, work)

    def test_supplied_detector_and_renderer_process_synthetic_motion(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            source = work / 'source.mp4'
            child = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
                                      '-s', '640x480', '-r', '15', '-i', '-', '-c:v', 'libx264',
                                      '-pix_fmt', 'yuv420p', str(source)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
            for index in range(90):
                frame = np.full((480, 640, 3), (30, 90, 30), dtype=np.uint8)
                offset = 0 if index < 30 else min(160, (index - 30) * 8)
                for ball in range(10):
                    cv2.circle(frame, (80 + (ball % 5) * 80 + offset, 180 + (ball // 5) * 120), 6, (240, 240, 240), -1)
                child.stdin.write(frame.tobytes())
            child.stdin.close()
            child.wait(timeout=30)
            child.stderr.close()
            self.assertEqual(child.returncode, 0)
            output, result = process_recording(source, JOB, work)
            self.assertTrue(output.is_file())
            self.assertGreater(result['clip_count'], 0)
            self.assertGreater(result['duration_seconds'], 0)

    def test_supplied_renderer_generates_real_h264_replay(self):
        from replay_processor import render_replay
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            source, output = work / 'source.mp4', work / 'replay.mp4'
            video(source)
            render_replay(source, [(1e-7, 0.8)], output, work / 'clips')
            self.assertGreater(verify_video(output)['duration_seconds'], 0)


if __name__ == '__main__':
    unittest.main()
