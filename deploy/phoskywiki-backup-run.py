#!/usr/bin/python3
"""Publish a health receipt only after creating AND verifying a recovery point."""
import json
import os
import pathlib
import subprocess
import time

started = int(time.time() * 1000)
base = ['docker', 'compose', '-f', 'compose.production.yml', '-f', 'compose.backup.yml', '--profile', 'backup', 'run', '--name', 'phoskywiki-scheduled-backup', '--rm', '-T', '--interactive=false', 'backup']
args = ['--config', '/run/secrets/backup-config.json', '--key-file', '/run/secrets/backup-encryption.key', '--target', 'postgres:5432/phoskywiki/phosky', '--bucket', 'phoskywiki-backups']

def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=3000)
    if result.returncode != 0:
        raise RuntimeError('BACKUP_COMMAND_FAILED')
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    if payload.get('ok') is not True:
        raise RuntimeError('BACKUP_RESULT_INVALID')
    return payload

try:
    created = run(base + ['create'] + args)
    verified = run(base + ['verify'] + args + ['--point', created['point']])
    if verified['point'] != created['point']:
        raise RuntimeError('BACKUP_POINT_MISMATCH')
    directory = pathlib.Path('/var/lib/phoskywiki')
    directory.mkdir(mode=0o700, exist_ok=True)
    temporary = directory / 'backup.json.tmp'
    temporary.write_text(json.dumps({'snapshotAt': started, 'verifiedAt': int(time.time() * 1000), 'point': created['point']}))
    temporary.chmod(0o600)
    os.replace(temporary, directory / 'backup.json')
    print(json.dumps({'ok': True, 'point': created['point'], 'verified': True}))
except Exception:
    print('BACKUP_CREATE_OR_VERIFY_FAILED')
    raise SystemExit(1)
finally:
    # Compose client termination does not stop Docker-owned work. Keep flock
    # until its named workload is removed, including subprocess timeouts.
    subprocess.run(['docker', 'rm', '-f', 'phoskywiki-scheduled-backup'], capture_output=True, timeout=30)
