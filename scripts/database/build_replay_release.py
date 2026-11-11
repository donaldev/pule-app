#!/usr/bin/env python3
"""Print an atomic replay release SQL bundle. Never connects to a database.

Requires production already through Phase 1. Original migration files stay intact;
only their outer transaction wrappers are replaced by one release transaction.
After a verified commit, record the three versions using migration repair.
"""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = (
    '202611100002_frame_replay_uploads.sql',
    '202611100003_frame_replay_processing.sql',
    '202611100004_replay_cleanup_accounting.sql',
)


def migration_body(source):
    lines = source.splitlines(keepends=True)
    begins = [i for i, line in enumerate(lines) if line.strip().lower() == 'begin;']
    commits = [i for i, line in enumerate(lines) if line.strip().lower() == 'commit;']
    if len(begins) != 1 or len(commits) != 1 or begins[0] >= commits[0]:
        raise ValueError('Unexpected migration transaction wrappers')
    if any(line.strip() and not line.lstrip().startswith('--') for line in lines[commits[0]+1:]):
        raise ValueError('Unexpected SQL after migration commit')
    return ''.join(line for i, line in enumerate(lines) if i not in (begins[0], commits[0]))


def build_bundle():
    parts = ["-- Review before use; this file does not record migration history.\nbegin;\nset local lock_timeout='5s';\n"]
    for name in MIGRATIONS:
        source = (ROOT/'supabase/migrations'/name).read_text()
        checksum = hashlib.sha256(source.encode()).hexdigest()
        parts.append(f'\n-- Source: {name}; sha256={checksum}\n')
        parts.append(migration_body(source))
    parts.append('\ncommit;\n')
    return ''.join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Write a local SQL artifact instead of stdout')
    args = parser.parse_args()
    result = build_bundle()
    if args.output:
        args.output.write_text(result)
    else:
        print(result, end='')


if __name__ == '__main__':
    main()
