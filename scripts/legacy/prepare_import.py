#!/usr/bin/env python3
"""Prepare a deterministic private import manifest. No SQL, network, or database writes."""
from pathlib import Path
import argparse
import hashlib
import json
from validate_history import (UPDATED_INPUT, UPDATED_SHA256, ROOT, ValidationError, baseline_checks,
                              canonical_json, digest, normalize, read_xlsx)


def manifest(proposal: dict, report: dict) -> dict:
    if proposal['input']['sha256'] != UPDATED_SHA256 or not all(c['passed'] for c in baseline_checks(proposal, report)):
        raise ValidationError('Updated approved baseline required')
    records = []
    def add(entity, key, value):
        # A comparison fingerprint, not an instruction to UPDATE on conflict.
        records.append({'entity': entity, 'key': key, 'content_sha256': digest(value)})
    for p in proposal['players']: add('player', p['id'], p)
    for p in proposal['group_players']: add('group_player', p['group_id'] + '/' + p['player_id'], p)
    for p in proposal['venues']: add('venue', p['id'], p)
    for p in proposal['sessions']:
        add('session', p['id'], p)
        for side, player in enumerate(p['participants'], 1):
            add('session_participant', p['id'] + '/' + player['player_id'], {'side':side, **player})
    for r in proposal['historical_reported_results']:
        add('reported_result', r['session_id'] + '/' + r['player_id'], {k:v for k,v in r.items() if k != 'provenance'})
        add('source_record', r['provenance']['observation_id'], r['provenance'])
    observations = proposal['raw_frame_observations'] + proposal['private_noncanonical_observations']
    for f in observations:
        key = f['provenance']['observation_id']
        add('source_record', key, f['provenance'])
        add('private_observation', key, f)
    for f in proposal['canonical_frames']:
        add('frame', f['id'], f)
        for p in f['participants']: add('frame_participant', f['id'] + '/' + p['player_id'], p)
    records.sort(key=lambda r:(r['entity'], r['key']))
    if len({(r['entity'],r['key']) for r in records}) != len(records):
        raise ValidationError('Manifest key collision')
    return {'mode':'offline_manifest_not_executable_sql', 'source':proposal['input'],
            'target_group':'REQUIRES_OWNER_BINDING', 'rule_version':'REQUIRES_LEGACY_UNKNOWN_RULE_BINDING',
            'policy':'same key and same content: skip; same key with different content: stop for review',
            'records':records, 'expected_completed_leaderboard':report['summary']['leaderboard'],
            'excluded_active_ids':sorted({r['legacy_match_id'] for r in proposal['incomplete_results_not_imported']}),
            'private_only_excluded_frame_rows':[r['provenance']['row'] for r in proposal['private_noncanonical_observations']]}


def compare(existing: dict, plan: dict) -> list[dict]:
    """Local idempotency simulation; never overwrites different content."""
    additions = []
    for r in plan['records']:
        key = (r['entity'], r['key'])
        if key in existing and existing[key] != r['content_sha256']:
            raise ValidationError('Existing key has different content; review required')
        if key not in existing: additions.append(r)
    return additions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=UPDATED_INPUT)
    parser.add_argument('--output-dir',type=Path,default=ROOT/'data/legacy/validation-nov-4')
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if not output.is_relative_to((ROOT/'data/legacy').resolve()) or output == (ROOT/'data/legacy').resolve():
        raise ValidationError('Output must remain below ignored data/legacy')
    wb = read_xlsx(args.input)
    proposal, report = normalize(wb)
    plan = manifest(proposal, report)
    if hashlib.sha256(args.input.read_bytes()).hexdigest() != wb.sha256:
        raise ValidationError('Input changed during preparation')
    output.mkdir(parents=True,exist_ok=True)
    target=output/'import-manifest.json'
    if target.is_symlink(): raise ValidationError('Refusing symlink output')
    target.write_text(canonical_json(plan))
    print(json.dumps({'prepared':True,'records':len(plan['records']),'output':str(target),'database_writes':False}))

if __name__=='__main__':
    main()
