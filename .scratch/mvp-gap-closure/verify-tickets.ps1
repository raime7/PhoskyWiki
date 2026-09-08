$ErrorActionPreference = 'Stop'
$taskRoot = 'D:\PhoskyWiki\.scratch\mvp-gap-closure'
$taskRepo = 'raime7/PhoskyWiki'
$taskMap = Get-Content -LiteralPath (Join-Path $taskRoot 'published.json') -Raw | ConvertFrom-Json -AsHashtable
$childrenJson = gh api "repos/$taskRepo/issues/18/sub_issues?per_page=100"
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify children' }
$children = @($childrenJson | ConvertFrom-Json)
$edgeCount = 0
foreach ($key in ($taskMap.Keys | Sort-Object)) {
    $entry = $taskMap[$key]
    if ($entry.number -notin $children.number) { throw "Missing parent association: $key" }
    $depsJson = gh api "repos/$taskRepo/issues/$($entry.number)/dependencies/blocked_by?per_page=100"
    if ($LASTEXITCODE -ne 0) { throw "Cannot verify dependencies: $key" }
    $actual = @($depsJson | ConvertFrom-Json | ForEach-Object { $_.number } | Sort-Object)
    $expected = @($entry.blockers | ForEach-Object { $taskMap[$_].number } | Sort-Object)
    if (($actual -join ',') -cne ($expected -join ',')) { throw "Dependency mismatch: $key" }
    $edgeCount += $actual.Count
}
$parentJson = gh issue view 18 --json body,state,title,labels
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify parent' }
$parentAfter = $parentJson | ConvertFrom-Json
$parentBefore = Get-Content -LiteralPath (Join-Path $taskRoot 'parent-before.json') -Raw | ConvertFrom-Json
foreach ($field in @('body','state','title')) {
    if ($parentAfter.$field -cne $parentBefore.$field) { throw "Parent changed: $field" }
}
if (($parentAfter.labels.name -join ',') -cne ($parentBefore.labels.name -join ',')) { throw 'Parent labels changed' }
$indexPath = Join-Path $taskRoot 'README.md'
$index = Get-Content -LiteralPath $indexPath -Raw
$index = $index.Replace('# 一期 MVP 修复工单草案', '# 一期 MVP 修复工单')
$index = $index.Replace('状态：待确认拆分粒度与依赖后发布至 GitHub，发布时替换草案编号为真实 issue 编号、标记 ready-for-agent 并建立原生依赖。父 Spec 的正文和状态保持原样。', '状态：已按确认方案发布 11 张 GitHub 工单，全部标记 ready-for-agent，并核验 11 个父子关联及 12 条原生阻塞关系。父 Spec 的正文、标题、状态与标签保持原样。')
$index += "`n## 已发布工单`n`n"
foreach ($key in ($taskMap.Keys | Sort-Object)) {
    $entry = $taskMap[$key]
    $index += "- [$($entry.title)]($($entry.url))；阻塞："
    if ($entry.blockers.Count -gt 0) { $index += (($entry.blockers | ForEach-Object { "#$($taskMap[$_].number)" }) -join '、') } else { $index += '无' }
    $index += "。`n"
    $localPath = Join-Path $taskRoot "issues/$($entry.file)"
    $local = Get-Content -LiteralPath $localPath -Raw
    $local = $local.Replace('工单草案，等待拆分方案确认；尚未发布。', "已发布：$($entry.url)。")
    $local | Set-Content -LiteralPath $localPath -Encoding utf8
}
$index | Set-Content -LiteralPath $indexPath -Encoding utf8
[pscustomobject]@{tickets=$taskMap.Count; nativeSubIssues=$taskMap.Count; verifiedBlockingEdges=$edgeCount; parentUnchanged=$true} | ConvertTo-Json
