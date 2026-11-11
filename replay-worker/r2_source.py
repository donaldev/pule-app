"""Server-only R2 source reader. No R2 URL or credentials are accepted from a job."""
import hashlib
import os
import re
import time

MAX_SOURCE_BYTES = 2147483648
BUCKET = 'pule-frame-recordings'


class R2Source:
    def __init__(self, env=None, client=None):
        env = os.environ if env is None else env
        if (not re.fullmatch(r'[a-f0-9]{32}', env.get('R2_ACCOUNT_ID', ''))
                or env.get('R2_RECORDINGS_BUCKET') != BUCKET
                or not env.get('R2_ACCESS_KEY_ID') or not env.get('R2_SECRET_ACCESS_KEY')):
            raise ValueError('R2 source reader is not configured')
        if client is None:
            import boto3
            from botocore.config import Config
            client = boto3.client('s3', endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                                  region_name='auto', aws_access_key_id=env['R2_ACCESS_KEY_ID'],
                                  aws_secret_access_key=env['R2_SECRET_ACCESS_KEY'],
                                  config=Config(signature_version='s3v4', connect_timeout=10, read_timeout=90,
                                                retries={'max_attempts': 0}, s3={'addressing_style': 'path'}))
        self.client = client

    def download(self, job, target):
        expected = job['expected_bytes']
        if not 1 <= expected <= MAX_SOURCE_BYTES:
            raise ValueError('Invalid R2 recording length')
        response = self.client.get_object(Bucket=BUCKET, Key=job['source_key'], IfMatch=job['source_etag'])
        body = response['Body']
        try:
            if (response.get('ContentLength') != expected or response.get('ContentType') != 'video/mp4'
                    or response.get('Metadata', {}).get('upload') != job['job_id']
                    or response.get('Metadata', {}).get('sha256') != job['source_sha256']):
                raise ValueError('R2 source evidence changed')
            digest, size, deadline = hashlib.sha256(), 0, time.monotonic() + 600
            with target.open('wb') as out:
                while chunk := body.read(1024 * 1024):
                    if time.monotonic() > deadline:
                        raise ValueError('Source download time limit exceeded')
                    size += len(chunk)
                    if size > expected:
                        raise ValueError('R2 source exceeds reservation')
                    digest.update(chunk)
                    out.write(chunk)
            if size != expected or digest.hexdigest() != job['source_sha256']:
                raise ValueError('R2 source does not match original recording')
        finally:
            body.close()
