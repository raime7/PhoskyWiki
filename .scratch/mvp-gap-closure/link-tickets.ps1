$ErrorActionPreference = 'Stop'
$taskRoot = 'D:\PhoskyWiki\.scratch\mvp-gap-closure'
$taskRepo = 'raime7/PhoskyWiki'
$taskMapFile = Join-Path $taskRoot 'published.json'
$taskMap = Get-Content -LiteralPath $taskMapFile -Raw | ConvertFrom-Json -AsHashtable
foreach ($key in ($taskMap.Keys | Sort-Object)) {
    $entry = $taskMap[$key]
    $source = Get-Content -LiteralPath (Join-Path $taskRoot "issues/$($entry.file)") -Raw
    $dependencySection = ($source -split '## Blocked by')[1]
    $entry.blockers = @([regex]::Matches($dependencySection, '\bR\d{2}\b') | ForEach-Object { $_.Value })
    $body = [regex]::Replace($source, '^# [^\r\n]+\r?\n\r?\n', '')
    $body = $body.Replace('工单草案，等待拆分方案确认；尚未发布。', '已确认实施工单。')
    $body = [regex]::Replace($body, '\bR\d{2}\b', { param($m) return "#$($taskMap[$m.Value].number)" })
    $bodyFile = Join-Path $taskRoot 'publish-body.md'
    $body | Set-Content -LiteralPath $bodyFile -Encoding utf8
    gh issue edit $entry.number --repo $taskRepo --body-file $bodyFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot update references: $key" }
    $issueJson = gh api "repos/$taskRepo/issues/$($entry.number)"
    if ($LASTEXITCODE -ne 0) { throw "Cannot read issue id: $key" }
    $remote = $issueJson | ConvertFrom-Json
    $entry.id = $remote.id
    if ($remote.body.Replace("`r`n", "`n").TrimEnd() -cne $body.Replace("`r`n", "`n").TrimEnd()) { throw "Body mismatch: $key" }
    if ('ready-for-agent' -notin $remote.labels.name) { throw "Label missing: $key" }
    Write-Output "Verified #$($entry.number) body and label"
}
$taskMap | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $taskMapFile -Encoding utf8
$existingJson = gh api "repos/$taskRepo/issues/18/sub_issues?per_page=100"
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect native sub-issues' }
$existingChildren = @($existingJson | ConvertFrom-Json | ForEach-Object { $_.number })
foreach ($key in ($taskMap.Keys | Sort-Object)) {
    $entry = $taskMap[$key]
    if ($entry.number -notin $existingChildren) {
        gh api --method POST "repos/$taskRepo/issues/18/sub_issues" -F "sub_issue_id=$($entry.id)" --silent
        if ($LASTEXITCODE -ne 0) { throw "Cannot associate sub-issue: $key" }
    }
    if ($entry.blockers.Count -gt 0) {
        $blockerJson = gh api "repos/$taskRepo/issues/$($entry.number)/dependencies/blocked_by?per_page=100"
        if ($LASTEXITCODE -ne 0) { throw "Cannot inspect blockers: $key" }
        $existingBlockers = @($blockerJson | ConvertFrom-Json | ForEach-Object { $_.number })
        foreach ($blocker in $entry.blockers) {
            $target = $taskMap[$blocker]
            if ($target.number -notin $existingBlockers) {
                gh api --method POST "repos/$taskRepo/issues/$($entry.number)/dependencies/blocked_by" -F "issue_id=$($target.id)" --silent
                if ($LASTEXITCODE -ne 0) { throw "Cannot link dependency: $key <- $blocker" }
            }
        }
    }
    Write-Output "Linked #$($entry.number): $($entry.blockers -join ', ')"
}
