param([string]$SecretDirectory = "$env:USERPROFILE\.codex\phoskywiki-secrets")
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$nodePath = (Get-Command node -ErrorAction Stop).Source
$result = & $nodePath (Join-Path $repository 'scripts\backup-retention.mjs') --config (Join-Path $SecretDirectory 'backup-config.json') --credentials (Join-Path $SecretDirectory 'backup-cleanup.json') --key-file (Join-Path $SecretDirectory 'backup-encryption.key') --bucket phoskywiki-backups --apply
if ($LASTEXITCODE -ne 0) { throw 'BACKUP_RETENTION_FAILED' }
$report = $result | ConvertFrom-Json
if ($report.ok -ne $true) { throw 'BACKUP_RETENTION_FAILED' }
$receipt = Join-Path $SecretDirectory 'retention.json'
@{ completedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); backupBytes = $report.backupBytes; deletedObjects = $report.deletedObjects; keptPoints = $report.keep.Count } | ConvertTo-Json | Set-Content -Encoding ascii -LiteralPath $receipt
& scp -q -i (Join-Path $SecretDirectory 'vultr-operator-ed25519') -o "UserKnownHostsFile=$(Join-Path $SecretDirectory 'known_hosts')" -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15 $receipt root@141.164.63.81:/var/lib/phoskywiki/retention.json
if ($LASTEXITCODE -ne 0) { throw 'RETENTION_RECEIPT_UPLOAD_FAILED' }
$result
