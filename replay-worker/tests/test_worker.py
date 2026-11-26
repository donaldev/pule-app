import sys
from pathlib import Path as _Path
sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json
import subprocess
import tempfile
import unittest
import io
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from replay_worker import SupabaseAPI, validate_job, validate_corners, verify_video, run_once, process_recording, prepare_analysis_source, verify_toolchain, main, run_batch, CLAIM_RUNTIME_RESERVE_SECONDS, MAX_BATCH_JOBS

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


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.jobs = []
        self.api = FakeAPI()
        self.calls = self.api.calls
        original_rpc = self.api.rpc

        def rpc(name, args):
            if name == 'claim_frame_replay_processing':
                self.calls.append((name, args))
                return self.jobs.pop(0) if self.jobs else None
            return original_rpc(name, args)

        self.api.rpc = rpc
        self.failed_ids = set()
        self.processing_seconds = 0

        def processor(source, job, work):
            self.now += self.processing_seconds
            if job['job_id'] in self.failed_ids:
                raise ValueError('private recording detail')
            output = work / 'replay.mp4'
            output.write_bytes(b'replay')
            return output, {'size_bytes': 6, 'clip_count': 1}

        for mock in (
            patch('replay_worker.verify_video', return_value={'size_bytes': 6, 'duration_seconds': 1}),
            patch('sys.stdout', new_callable=io.StringIO),
            patch.dict('os.environ', {'GITHUB_STEP_SUMMARY': ''}),
        ):
            mock.start()
            self.addCleanup(mock.stop)
        self.processor = processor

    def job(self, index):
        job_id = f'aaaaaaaa-aaaa-aaaa-aaaa-{index:012d}'
        return {**JOB, 'job_id': job_id, 'source_key': PREFIX + job_id + '.mp4'}

    def batch(self, seconds=60, max_jobs=MAX_BATCH_JOBS):
        def attempt(api, **kwargs):
            return run_once(api, processor=self.processor, **kwargs)
        with patch('replay_worker.run_once', side_effect=attempt):
            return run_batch(self.api, max_jobs=max_jobs, clock=lambda: self.now,
                             deadline=self.now + CLAIM_RUNTIME_RESERVE_SECONDS + seconds)

    def test_empty_queue(self):
        self.assertEqual(self.batch(), {
            'processed': 0, 'completed': 0, 'failed': 0, 'unconfirmed': 0,
            'stop': 'queue_empty', 'elapsed_seconds': 0,
        })

    def test_sequential_publication_after_failure_and_explicit_retry_next_run(self):
        first, second = self.job(1), self.job(2)
        self.jobs = [first, second]
        self.failed_ids.add(first['job_id'])
        summary = self.batch()
        self.assertEqual((summary['failed'], summary['completed'], summary['stop']), (1, 1, 'queue_empty'))
        self.assertEqual([name for name, _ in self.calls], [
            'claim_frame_replay_processing', 'download', 'fail_frame_replay_processing',
            'claim_frame_replay_processing', 'download', 'upload', 'complete_frame_replay_processing',
            'claim_frame_replay_processing',
        ])
        self.assertNotIn('private recording detail', sys.stdout.getvalue())
        self.assertNotIn(first['job_id'], sys.stdout.getvalue())
        # Only an externally eligible new lease can be processed on a later run.
        retry_lease = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
        self.jobs = [{**first, 'lease_id': retry_lease, 'destination_key': PREFIX + retry_lease + '.mp4'}]
        self.failed_ids.clear()
        self.assertEqual(self.batch()['completed'], 1)
        self.assertEqual(self.calls[-2][1]['p_lease'], retry_lease)

    def test_duplicate_claim_stops_before_a_second_download(self):
        first = self.job(1)
        self.jobs = [first, first]
        self.failed_ids.add(first['job_id'])
        summary = self.batch()
        self.assertEqual((summary['failed'], summary['stop']), (1, 'duplicate_claim'))
        self.assertEqual(sum(name == 'download' for name, _ in self.calls), 1)

    def test_time_budget_applies_before_first_and_later_claims(self):
        self.jobs = [self.job(1), self.job(2)]
        self.assertEqual(self.batch(seconds=-1)['stop'], 'runtime_limit')
        self.assertEqual(self.calls, [])
        self.processing_seconds = 61
        summary = self.batch()
        self.assertEqual((summary['completed'], summary['stop'], summary['elapsed_seconds']), (1, 'runtime_limit', 61))
        self.assertEqual(len(self.jobs), 1)

    def test_batch_count_and_manual_single_job_cap(self):
        self.jobs = [self.job(index) for index in range(MAX_BATCH_JOBS + 2)]
        self.assertEqual(self.batch()['stop'], 'job_limit')
        self.assertEqual(len(self.jobs), 2)
        self.assertEqual(self.batch(max_jobs=1)['completed'], 1)
        self.assertEqual(len(self.jobs), 1)

    def test_default_cli_passes_one_job(self):
        with patch('sys.argv', ['replay_worker.py']), patch('replay_worker.verify_toolchain'), \
             patch('replay_worker.SupabaseAPI'), patch.dict('os.environ', {
                 'R2_ACCOUNT_ID': '', 'SUPABASE_URL': 'https://example.com', 'SUPABASE_SERVICE_ROLE_KEY': 'test',
             }), patch('replay_worker.run_batch', return_value={'failed': 0, 'unconfirmed': 0, 'stop': 'job_limit'}) as batch:
            main()
            self.assertEqual(batch.call_args.kwargs['max_jobs'], 1)


class WorkerTests(unittest.TestCase):
    def test_toolchain_failure_cannot_claim_a_job(self):
        with patch('sys.argv', ['replay_worker.py']), patch('replay_worker.verify_toolchain', side_effect=ValueError('old ffmpeg')), patch('replay_worker.run_once') as run, patch('sys.stdout', new_callable=io.StringIO):
            with self.assertRaises(SystemExit):
                main()
            run.assert_not_called()

    def test_check_needs_no_credentials_or_network(self):
        with patch('sys.argv', ['replay_worker.py', '--check']), patch('replay_worker.verify_toolchain'), patch('replay_worker.SupabaseAPI') as api, patch('sys.stdout', new_callable=io.StringIO) as output:
            main()
            self.assertEqual(json.loads(output.getvalue())['status'], 'toolchain_ready')
            api.assert_not_called()

    def test_missing_display_rotation_is_rejected(self):
        with patch('replay_worker.subprocess.run', return_value=subprocess.CompletedProcess([], 0, 'legacy ffmpeg', '')):
            with self.assertRaises(ValueError):
                verify_toolchain()

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
            for angle in (0, 90, 180, 270):
                rotated = work / f'phone-{angle}.mp4'
                subprocess.run(['ffmpeg', '-y', '-v', 'error', '-display_rotation:v:0', str(angle), '-i', str(source), '-c', 'copy', str(rotated)], check=True, capture_output=True)
                jobdir = work / str(angle)
                jobdir.mkdir()
                output, result = process_recording(rotated, JOB, jobdir)
                self.assertTrue(output.is_file())
                self.assertGreater(result['clip_count'], 0)
                self.assertGreater(result['duration_seconds'], 0)
                probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                        '-show_entries', 'stream_side_data=rotation', '-of', 'json', str(output)],
                                       check=True, capture_output=True, text=True)
                streams = json.loads(probe.stdout)['streams']
                rotations = [item['rotation'] for stream in streams for item in stream.get('side_data_list', []) if 'rotation' in item]
                self.assertEqual((int(rotations[0]) if rotations else 0) % 360, angle)

    def test_phone_orientation_remux_preserves_encoded_dimensions_and_corner_space(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            original = work / 'source.mp4'
            video(original)
            for angle in (0, 90, 180, 270):
                rotated = work / f'phone-{angle}.mp4'
                subprocess.run(['ffmpeg', '-y', '-v', 'error', '-display_rotation:v:0', str(angle), '-i', str(original), '-c', 'copy', str(rotated)], check=True, capture_output=True)
                jobdir = work / str(angle)
                jobdir.mkdir()
                analysis, rotation = prepare_analysis_source(rotated, jobdir)
                self.assertEqual(rotation, angle)
                self.assertEqual(validate_corners(analysis, JOB).shape, (4, 2))

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
