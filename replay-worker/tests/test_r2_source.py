import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hashlib
import io
import tempfile
import unittest
from unittest.mock import patch
from r2_source import R2Source
from replay_worker import validate_job, run_once
from test_worker import JOB, FakeAPI

ENV = {'R2_ACCOUNT_ID': 'a'*32, 'R2_RECORDINGS_BUCKET': 'pule-frame-recordings', 'R2_ACCESS_KEY_ID': 'example', 'R2_SECRET_ACCESS_KEY': 'example'}
SOURCE = b'original recording'
R2_JOB = {**JOB, 'source_provider': 'r2', 'source_bucket': 'pule-frame-recordings', 'source_sha256': hashlib.sha256(SOURCE).hexdigest(), 'source_etag': '"immutable-etag"', 'expected_bytes': len(SOURCE)}


class Client:
    def __init__(self, body=SOURCE, length=None, metadata=None):
        self.body = io.BytesIO(body)
        self.length = len(body) if length is None else length
        self.metadata = metadata if metadata is not None else {'upload': JOB['job_id'], 'sha256': R2_JOB['source_sha256']}
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        return {'Body': self.body, 'ContentLength': self.length, 'ContentType': 'video/mp4', 'Metadata': self.metadata}


class R2SourceTests(unittest.TestCase):
    def test_fixed_bucket_and_endpoint_configuration(self):
        for field, value in [('R2_ACCOUNT_ID', 'https://evil.test'), ('R2_RECORDINGS_BUCKET', 'frame-replays'), ('R2_SECRET_ACCESS_KEY', '')]:
            with self.assertRaises(ValueError):
                R2Source({**ENV, field: value}, Client())

    def test_source_hash_length_metadata_and_etag_are_verified_streaming(self):
        client = Client()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'source.mp4'
            R2Source(ENV, client).download(R2_JOB, target)
            self.assertEqual(target.read_bytes(), SOURCE)
        self.assertEqual(client.calls, [{'Bucket': 'pule-frame-recordings', 'Key': JOB['source_key'], 'IfMatch': '"immutable-etag"'}])
        self.assertTrue(client.body.closed)

    def test_changed_truncated_or_oversized_source_is_rejected_and_closed(self):
        for client in [Client(b'changed recording', len(SOURCE)), Client(SOURCE[:-1], len(SOURCE)), Client(SOURCE+b'extra', len(SOURCE)), Client(metadata={'upload': 'another', 'sha256': R2_JOB['source_sha256']})]:
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                R2Source(ENV, client).download(R2_JOB, Path(directory)/'source.mp4')
            self.assertTrue(client.body.closed)

    def test_large_cap_is_source_only_and_provider_specific(self):
        validate_job({**R2_JOB, 'expected_bytes': 1500000000})
        for job in [{**JOB, 'expected_bytes': 1500000000}, {**R2_JOB, 'expected_bytes': 2147483649}, {**R2_JOB, 'source_bucket': 'other'}, {**R2_JOB, 'source_sha256': ''}]:
            with self.assertRaises(ValueError):
                validate_job(job)

    def test_r2_worker_reuses_verified_supabase_publication_and_never_deletes_source(self):
        class API(FakeAPI):
            def rpc(self, name, args):
                if name == 'claim_r2_frame_replay_processing':
                    self.calls.append((name, args))
                    return dict(R2_JOB)
                return super().rpc(name, args)
        api = API()
        def processor(source, job, work):
            self.assertEqual(source.read_bytes(), SOURCE)
            result = work/'replay.mp4';result.write_bytes(b'out')
            return result, {'size_bytes': 3, 'duration_seconds': 1, 'clip_count': 1}
        with patch('replay_worker.verify_video', return_value={'size_bytes': 3, 'duration_seconds': 1}):
            result = run_once(api, processor, R2Source(ENV, Client()))
        self.assertEqual(result['status'], 'completed')
        self.assertFalse(any(name == 'download' for name, _ in api.calls))
        names = [name for name, _ in api.calls]
        self.assertLess(names.index('upload'), names.index('complete_frame_replay_processing'))
        self.assertFalse(hasattr(R2Source, 'delete'))


if __name__ == '__main__':
    unittest.main()
