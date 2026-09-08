$ErrorActionPreference = 'Stop'
$taskRoot = 'D:\PhoskyWiki\.scratch\mvp-gap-closure'
$taskRepo = 'raime7/PhoskyWiki'
$taskMapFile = Join-Path $taskRoot 'published.json'
$taskMap = @{}
if (Test-Path -LiteralPath $taskMapFile) {
    $taskMap = Get-Content -LiteralPath $taskMapFile -Raw | ConvertFrom-Json -AsHashtable
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'parent-before.json'))) {
    $parentJson = gh issue view 18 --json body,state,title,labels
    if ($LASTEXITCODE -ne 0) { throw 'Cannot snapshot parent issue' }
    $parentJson | Set-Content -LiteralPath (Join-Path $taskRoot 'parent-before.json') -Encoding utf8
}
$taskFiles = Get-ChildItem -LiteralPath (Join-Path $taskRoot 'issues') -File | Sort-Object Name
foreach ($ticketFile in $taskFiles) {
    $source = Get-Content -LiteralPath $ticketFile.FullName -Raw
    $heading = [regex]::Match($source, '^# (R\d{2}): (.+)')
    if (-not $heading.Success) { throw "Invalid ticket: $($ticketFile.Name)" }
    $key = $heading.Groups[1].Value
    $title = "[$key] $($heading.Groups[2].Value.Trim())"
    if ($taskMap.ContainsKey($key)) { continue }
    $body = [regex]::Replace($source, '^# [^\r\n]+\r?\n\r?\n', '')
    $body = $body.Replace('工单草案，等待拆分方案确认；尚未发布。', '已确认实施工单。')
    $body = [regex]::Replace($body, '\bR\d{2}\b', {
        param($m)
        if ($taskMap.ContainsKey($m.Value)) { return "#$($taskMap[$m.Value].number)" }
        return $m.Value
    })
    $bodyFile = Join-Path $taskRoot 'publish-body.md'
    $body | Set-Content -LiteralPath $bodyFile -Encoding utf8
    $createdUrl = gh issue create --repo $taskRepo --title $title --body-file $bodyFile --label ready-for-agent
    if ($LASTEXITCODE -ne 0) { throw "Failed creating $key; inspect tracker before retry" }
    $url = ($createdUrl | Select-Object -Last 1).Trim()
    if ($url -notmatch '/issues/(\d+)$') { throw "Unexpected creation response: $url" }
    $taskMap[$key] = @{ number = [int]$Matches[1]; url = $url; title = $title; file = $ticketFile.Name }
    $taskMap | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $taskMapFile -Encoding utf8
    Write-Output "$key -> $url"
}
