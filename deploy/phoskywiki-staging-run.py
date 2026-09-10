#!/usr/bin/python3
"""Drain bounded staging batches; publish freshness only after the queue drains."""
import json
import os
from pathlib import Path
import subprocess
import time

NAME = 'phoskywiki-staging-cleanup'


def main():
    config = json.loads(Path('/etc/phoskywiki/secrets/runtime.json').read_text())
    if config.get('PHOSKYWIKI_ENV') != 'production' or config.get('R2_BUCKET') != 'phoskywiki-images':
        raise ValueError('TARGET_MISMATCH')
    base = ['docker', 'compose', '-f', 'compose.production.yml', '-f', 'compose.maintenance.yml',
            '--profile', 'ops', 'run', '--name', NAME, '--rm', '-T', '--interactive=false', '--no-deps',
            'ops', 'images', 'cleanup', '--environment', 'production',
            '--target', 'postgres:5432/phoskywiki/phosky', '--bucket', config['R2_BUCKET'],
            '--endpoint', config['R2_ENDPOINT'], '--batch', '500', '--apply']
    processed = 0
    # Bound each run even if writes keep arriving. No success receipt on backlog.
    deadline = time.monotonic() + 18 * 60
    for _ in range(100):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        result = subprocess.run(base, capture_output=True, text=True, timeout=min(remaining, 300))
        if result.returncode:
            raise RuntimeError('STAGING_COMMAND_FAILED')
        report = json.loads(result.stdout.strip().splitlines()[-1])
        cleanup = report['cleanup']
        if report['ok'] is not True or cleanup['apply'] is not True or cleanup['failed'] != 0 or type(cleanup['batchFull']) is not bool:
            raise ValueError('STAGING_RESULT_INVALID')
        processed += cleanup['processed']
        if not cleanup['batchFull']:
            directory = Path('/var/lib/phoskywiki')
            directory.mkdir(mode=0o700, exist_ok=True)
            temporary = directory / 'staging.json.tmp'
            temporary.write_text(json.dumps({'completedAt': int(time.time()*1000), 'processed': processed}))
            temporary.chmod(0o600)
            os.replace(temporary, directory / 'staging.json')
            print(json.dumps({'ok': True, 'processed': processed}))
            return
    raise RuntimeError('STAGING_BACKLOG')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('STAGING_CLEANUP_FAILED')
        raise SystemExit(1)
    finally:
        subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True, timeout=30)
