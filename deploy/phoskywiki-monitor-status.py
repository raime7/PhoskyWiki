#!/usr/bin/python3
"""Forced SSH command: emit only non-secret operational measurements."""
import json
import pathlib
import shutil
import subprocess
import time

def command(*args):
    return subprocess.run(args, capture_output=True, text=True, timeout=15).stdout.strip()

def receipt(name):
    try:
        return json.loads(pathlib.Path('/var/lib/phoskywiki/' + name).read_text())
    except (OSError, ValueError):
        return {}

memory = dict(line.split(':', 1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
total = int(memory['MemTotal'].split()[0])
available = int(memory['MemAvailable'].split()[0])
disk = shutil.disk_usage('/var/lib/docker')
ids = command('docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=phoskywiki').split()
containers = json.loads(command('docker', 'inspect', *ids)) if ids else []
services = {c['Config']['Labels'].get('com.docker.compose.service'): c for c in containers}
healthy = all(name in services and services[name]['State'].get('Health', {}).get('Status') == 'healthy' for name in ['app', 'postgres', 'meilisearch', 'proxy'])
search = None
if 'app' in services:
    try:
        search = json.loads(command('docker', 'exec', services['app']['Id'], 'timeout', '--kill-after=2s', '10s', 'node',
            'scripts/container-entrypoint.mjs', 'search-status', '--target',
            'postgres:5432/phoskywiki/phosky', '--search', 'http://meilisearch:7700/pages'))['search']
    except (ValueError, KeyError, subprocess.TimeoutExpired):
        pass
def rotated(container):
    logging = container['HostConfig']['LogConfig']
    return logging['Type'] == 'json-file' and logging.get('Config', {}).get('max-size') == '10m' and logging.get('Config', {}).get('max-file') == '3'
print(json.dumps({
    'timestamp': int(time.time() * 1000),
    'backupVerifiedAt': receipt('backup.json').get('snapshotAt', 0),
    'backupResult': command('systemctl', 'show', 'phoskywiki-backup.service', '--property=Result', '--value'),
    'timerActive': command('systemctl', 'is-active', 'phoskywiki-backup.timer') == 'active',
    'containersHealthy': healthy,
    'diskPercent': round(disk.used / disk.total * 100, 1),
    'memoryPercent': round((total - available) / total * 100, 1),
    'retentionAt': receipt('retention.json').get('completedAt', 0),
    'backupBytes': receipt('retention.json').get('backupBytes'),
    'search': search,
    'searchTimerActive': command('systemctl', 'is-active', 'phoskywiki-search.timer') == 'active',
    'searchResult': command('systemctl', 'show', 'phoskywiki-search.service', '--property=Result', '--value'),
    'restartCount': max((c.get('RestartCount', 0) for c in containers), default=0),
    'logsRotated': bool(containers) and all(rotated(c) for c in containers),
}))
