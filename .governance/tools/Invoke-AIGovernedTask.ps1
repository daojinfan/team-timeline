[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [Parameter(Mandatory = $true)][ValidateSet("Plan", "RebasePlan", "MigrateTask", "AssignReview", "MigrateReviewer", "MigrateCompletedReviewerBaseline", "ReopenReview", "ReopenAcceptance", "RecordReview", "RecordApproval", "Start", "Block", "NeedsDecision", "Resume", "Recover", "Supersede", "Verify", "Accept", "Status")][string]$Action,
    [ValidatePattern('^TASK-\d{3,}$')][string]$TaskId,
    [ValidatePattern('^WP-\d{3,}$')][string]$WorkPackage,
    [string]$Title,
    [string]$Goal,
    [ValidateSet("Lite", "Standard", "Release")][string]$Profile,
    [ValidateSet("ANALYST", "ARCHITECT", "IMPLEMENTER", "TESTER", "INTEGRATOR", "REVIEWER")][string]$Role = "IMPLEMENTER",
    [string[]]$AllowedPath = @(),
    [string[]]$ReadPath = @(),
    [string[]]$OutOfScope = @(),
    [string[]]$Document = @(),
    [string[]]$Dependency = @(),
    [string[]]$RepairOf = @(),
    [string[]]$AcceptanceCriterion = @(),
    [string[]]$ValidationJson = @(),
    [ValidatePattern('^[A-Za-z][A-Za-z0-9._-]{1,63}$')][string]$ValidationId = "required-validation",
    [string]$ValidationCommand,
    [string[]]$ValidationArgument = @(),
    [string]$ValidationArgsBase64,
    [string]$TargetEnvironment,
    [string]$ExecutionWindow,
    [string]$RollbackPlan,
    [string]$ObservationMetrics,
    [string]$StopConditions,
    [string]$PostReleaseOwner,
    [ValidateSet("scope", "success_criteria", "overall_architecture", "public_interface", "data_model_or_migration", "security_privacy_compliance", "quality_gate_exception", "production_release", "irreversible_operation")][string[]]$RiskFlag = @(),
    [ValidatePattern('^APR-\d{3,}$')][string]$ApprovalId,
    [ValidatePattern('^TASK-\d{3,}$')][string]$ReviewerTaskId,
    [ValidateSet("passed", "changes-required", "cancelled")][string]$ReviewResult,
    [string[]]$ReviewEvidence = @(),
    [ValidateSet("execution", "acceptance")][string]$ApprovalType,
    [string]$ApprovalText,
    [string]$Approver,
    [ValidatePattern('^CONF-[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$')][string]$ConfirmationId,
    [string]$LeaseId,
    [string]$LeaseOwner,
    [string]$Reason
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$root = [System.IO.Path]::GetFullPath($ProjectPath)
$script:GovernancePathComparison = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
$script:GovernancePathComparer = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }
$runtimeRoot = Join-Path $root ".governance/runtime/tasks"
$lockIdentity = $root
try {
    $commonDirectory = [string](& git -c "safe.directory=$($root.Replace('\', '/'))" -C $root rev-parse --git-common-dir 2>$null)
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($commonDirectory)) {
        $lockIdentity = if ([System.IO.Path]::IsPathRooted($commonDirectory.Trim())) { [System.IO.Path]::GetFullPath($commonDirectory.Trim()) } else { [System.IO.Path]::GetFullPath((Join-Path $root $commonDirectory.Trim())) }
    }
} catch { $lockIdentity = $root }
$lockHasher = [System.Security.Cryptography.SHA256]::Create()
try { $lockKey = ([BitConverter]::ToString($lockHasher.ComputeHash($script:GovernanceUtf8NoBom.GetBytes($lockIdentity.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant()).Substring(0, 24) }
finally { $lockHasher.Dispose() }
$lockPath = Join-Path ([System.IO.Path]::GetTempPath()) "large-project-governance-locks/$lockKey.ai-task.lock"
$transactionJournalPath = Join-Path ([System.IO.Path]::GetTempPath()) "large-project-governance-locks/$lockKey.ai-task.transaction.json"
$workStatusPath = Join-Path $root "docs/04-delivery/WORK-STATUS.md"
$approvalLogPath = Join-Path $root "docs/00-index/APPROVAL-LOG.md"
$governancePath = Join-Path $root "governance.json"
$ReviewEvidence = @($ReviewEvidence | ForEach-Object { @(([string]$_) -split '\s*,\s*') } | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } | Select-Object -Unique)
foreach ($required in @($governancePath, $workStatusPath, $approvalLogPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required AI governance source not found: $required" }
}

function Assert-NoLinkedProjectPath([string]$RelativePath) {
    $current = $root
    foreach ($segment in @($RelativePath.Replace('\', '/').Trim('/') -split '/')) {
        if (-not $segment) { continue }
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) { break }
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Governed project paths cannot traverse a symbolic link or junction: $RelativePath" }
    }
}

function Assert-NoSecretValidationArguments([string[]]$Arguments) {
    foreach ($argument in @($Arguments)) {
        if ($argument -match '^(?i)(?:--?|/)(?:password|passwd|secret|token|api[-_]?key|authorization)(?:=|:|$)' -or
            $argument -match '(?i)\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b') {
            throw 'Validation arguments appear to contain or request a secret. Use environment-based credentials and ensure the validation command does not print them.'
        }
    }
}

function Protect-EvidenceOutput([string]$Content) {
    $protected = if ($null -eq $Content) { '' } else { $Content }
    $count = 0
    foreach ($pattern in @(
        '(?im)(\b(?:authorization|password|passwd|secret|token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*)([^\s,;]+)',
        '(?i)\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b'
    )) {
        $regex = [regex]::new($pattern)
        $matches = $regex.Matches($protected)
        if ($matches.Count -eq 0) { continue }
        $count += $matches.Count
        if ($regex.GetGroupNumbers().Count -gt 1) { $protected = $regex.Replace($protected, '${1}[REDACTED]') }
        else { $protected = $regex.Replace($protected, '[REDACTED]') }
    }
    return [pscustomobject]@{ Content=$protected; Count=$count }
}

function Normalize-RelativePath([string]$Value) {
    $clean = $Value.Trim().Trim('`').Replace('\', '/').TrimStart('/').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($clean) -or $clean -in @('.', '*') -or $clean.Contains('*') -or [System.IO.Path]::IsPathRooted($clean)) { throw "Unsafe or overly broad governed path: $Value" }
    if ($clean -match '^(?i)(?:\.git|\.governance)(?:/|$)') { throw "Runtime and repository-control paths cannot be delegated as task scope: $Value" }
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $root $clean))
    $prefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, $script:GovernancePathComparison)) { throw "Governed path escapes the project root: $Value" }
    Assert-NoLinkedProjectPath $clean
    return $clean
}

function Test-PathWithin([string]$Path, [string]$Scope) {
    $pathValue = $Path.Replace('\', '/').Trim('/')
    $scopeValue = $Scope.Replace('\', '/').Trim('/')
    return $pathValue.Equals($scopeValue, $script:GovernancePathComparison) -or $pathValue.StartsWith($scopeValue + '/', $script:GovernancePathComparison)
}

function Test-ScopesOverlap([string]$Left, [string]$Right) {
    return (Test-PathWithin $Left $Right) -or (Test-PathWithin $Right $Left)
}

function Invoke-GitOutput([string[]]$Arguments) {
    return @(Invoke-GovernanceGitOutput -ProjectRoot $root -Arguments $Arguments)
}

function Get-GitCommit {
    try { $commit = @(Invoke-GitOutput -Arguments @('rev-parse', 'HEAD')) } catch { throw "AI governed execution requires a Git repository with an initial commit." }
    if ($commit.Count -eq 0 -or -not $commit[0]) { throw "AI governed execution requires a Git repository with an initial commit." }
    return ([string]$commit[0]).Trim()
}

function Get-ChangedEntries([string]$BaseCommit = '') {
    return @(Get-GovernanceGitChangedEntries -ProjectRoot $root -BaseCommit $BaseCommit)
}

function Get-ChangedPaths([string]$BaseCommit = '') {
    $paths = [System.Collections.Generic.HashSet[string]]::new($script:GovernancePathComparer)
    foreach ($entry in @(Get-ChangedEntries -BaseCommit $BaseCommit)) {
        [void]$paths.Add([string]$entry.path)
        if (-not [string]::IsNullOrWhiteSpace([string]$entry.old_path)) { [void]$paths.Add([string]$entry.old_path) }
    }
    return @($paths)
}

function Test-SystemPath([string]$Path, [string]$CurrentTask, [string]$CurrentWorkPackage) {
    $normalized = $Path.Replace('\', '/')
    return $normalized.StartsWith('.governance/runtime/tasks/', $script:GovernancePathComparison) -or
        $normalized.Equals(".governance/context/$CurrentWorkPackage.generated.md", $script:GovernancePathComparison) -or
        $normalized.Equals('docs/04-delivery/WORK-STATUS.md', $script:GovernancePathComparison) -or
        $normalized.Equals('docs/04-delivery/TASK-LEDGER.md', $script:GovernancePathComparison) -or
        $normalized.Equals('docs/00-index/APPROVAL-LOG.md', $script:GovernancePathComparison) -or
        $normalized.StartsWith('docs/05-quality/evidence/', $script:GovernancePathComparison)
}

function Get-ProtectedGovernanceSnapshot {
    $snapshot = [System.Collections.Generic.Dictionary[string,string]]::new($(if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }))
    $relativeRoots = @('.governance/runtime/tasks', 'docs/05-quality/evidence')
    $relativeFiles = @('docs/04-delivery/WORK-STATUS.md', 'docs/04-delivery/TASK-LEDGER.md', 'docs/00-index/APPROVAL-LOG.md')
    $recordItem = {
        param([System.IO.FileSystemInfo]$Item)
        $relative = $Item.FullName.Substring($root.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $snapshot[$relative] = 'REPARSE-POINT'; return }
        if ($Item.PSIsContainer) { $snapshot[$relative] = 'DIRECTORY'; return }
        $snapshot[$relative] = (Get-FileHash -LiteralPath $Item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    foreach ($relativeFile in $relativeFiles) {
        $resolved = Join-Path $root $relativeFile
        if (Test-Path -LiteralPath $resolved) { & $recordItem (Get-Item -LiteralPath $resolved -Force) }
    }
    foreach ($relativeRoot in $relativeRoots) {
        $resolvedRoot = Join-Path $root $relativeRoot
        if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) { continue }
        $rootItem = Get-Item -LiteralPath $resolvedRoot -Force
        & $recordItem $rootItem
        if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $pending = [System.Collections.Generic.Queue[System.IO.DirectoryInfo]]::new()
        $pending.Enqueue($rootItem)
        while ($pending.Count -gt 0) {
            $directory = $pending.Dequeue()
            foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop)) {
                & $recordItem $item
                if ($item.PSIsContainer -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) { $pending.Enqueue($item) }
            }
        }
    }
    return ,$snapshot
}

function Compare-ProtectedGovernanceSnapshot($Before, $After) {
    $paths = @(@($Before.Keys) + @($After.Keys) | Select-Object -Unique)
    return @($paths | Where-Object { -not $Before.ContainsKey($_) -or -not $After.ContainsKey($_) -or $Before[$_] -ne $After[$_] } | Sort-Object)
}

function Get-TaskPaths([string]$Id) {
    return [pscustomobject]@{
        Contract = Join-Path $runtimeRoot "$Id.contract.json"
        State = Join-Path $runtimeRoot "$Id.state.json"
    }
}

function Read-TaskPair([string]$Id) {
    $paths = Get-TaskPaths $Id
    foreach ($path in @($paths.Contract, $paths.State)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Governed task artifact not found: $path" } }
    $contract = [System.IO.File]::ReadAllText($paths.Contract, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop
    $state = [System.IO.File]::ReadAllText($paths.State, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop
    $hash = (Get-FileHash -LiteralPath $paths.Contract -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([string]$state.contract_sha256 -ne $hash) { throw "Governed task contract has changed after planning: $Id" }
    if ([string]$contract.task_id -ne $Id -or [string]$state.task_id -ne $Id -or [string]$contract.work_package -ne [string]$state.work_package) { throw "Governed task artifacts are inconsistent: $Id" }
    return [pscustomobject]@{ Paths=$paths; Contract=$contract; State=$state; Hash=$hash }
}

function Get-TaskWritePaths($Contract) {
    $paths = @($Contract.write_paths | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($paths.Count -eq 0) { $paths = @($Contract.allowed_paths) }
    return @($paths | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ })
}

function Get-TaskReadPaths($Contract) {
    $paths = @($Contract.read_paths | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($paths.Count -eq 0) { $paths = @(Get-TaskWritePaths $Contract) }
    return @($paths | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ })
}

function Get-RequiredReviewRounds($Contract) {
    if ([string](Get-Property $Contract 'profile') -eq 'Lite') { return 1 }
    return 2
}

function Test-TaskDependencyReady($TaskPair, [string]$DependencyId, $DependencyPair) {
    $dependencyState = [string]$DependencyPair.State.state
    if ($dependencyState -in @('verified', 'accepted')) { return $true }
    $repairTargets = @((Get-Property $TaskPair.Contract 'repair_of') | ForEach-Object { [string]$_ })
    $dependencyReview = Get-Property $DependencyPair.State 'review'
    return $DependencyId -in $repairTargets -and $dependencyState -eq 'implemented' -and [string](Get-Property $dependencyReview 'status') -eq 'changes-required'
}

function Get-ProfileRank([string]$Value) { return @{ Lite=1; Standard=2; Release=3 }[[string]$Value] }

function Get-MinimumTaskProfile([object]$Contract, [string[]]$Risks) {
    $minimum = 1
    if (@($Risks | Where-Object { $_ -in @('scope', 'success_criteria', 'overall_architecture', 'public_interface') }).Count -gt 0) { $minimum = 2 }
    if (@($Risks | Where-Object { $_ -in @('data_model_or_migration', 'security_privacy_compliance', 'quality_gate_exception', 'production_release', 'irreversible_operation') }).Count -gt 0) { $minimum = 3 }
    return @('Lite', 'Standard', 'Release')[$minimum - 1]
}

function Get-ProfileValidationLevel([string]$Profile) {
    if ($Profile -eq 'Release') { return 'Release' }
    return 'Strict'
}

function Assert-ReviewerWriteScope($Contract, [string]$TaskId) {
    if ([string](Get-Property $Contract 'role') -ne 'REVIEWER') { return }
    $expectedScope = "docs/05-quality/evidence/$TaskId"
    $writePaths = @(Get-TaskWritePaths $Contract)
    if ($writePaths.Count -eq 0 -or @($writePaths | Where-Object { -not (Test-PathWithin ([string]$_) $expectedScope) }).Count -gt 0) {
        throw "REVIEWER task $TaskId may only write within $expectedScope."
    }
    $allowedPaths = @($Contract.allowed_paths | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ })
    if ($allowedPaths.Count -eq 0 -or @($allowedPaths | Where-Object { -not (Test-PathWithin ([string]$_) $expectedScope) }).Count -gt 0) {
        throw "REVIEWER task $TaskId allowed_paths must stay within $expectedScope."
    }
}

function Get-TeamLedgerRows {
    $governance = Read-GovernanceJson -Path $governancePath
    if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { return @() }
    $ledgerRelative = [string]$governance.authoritative_documents.task_ledger
    if ([string]::IsNullOrWhiteSpace($ledgerRelative)) { throw 'TEAM_PROJECT requires authoritative_documents.task_ledger.' }
    $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root $ledgerRelative))
    $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $ledgerPath.StartsWith($rootPrefix, $script:GovernancePathComparison) -or -not (Test-Path -LiteralPath $ledgerPath -PathType Leaf)) { throw 'TEAM_PROJECT task ledger is missing or outside the project.' }
    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($line in ([System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom) -split "\r?\n")) {
        if ($line -notmatch '^\s*\|(.+)\|\s*$') { continue }
        $cells = @($Matches[1] -split '\|' | ForEach-Object { $_.Trim() })
        if ($cells.Count -lt 15 -or $cells[1] -notmatch '^TASK-\d{3,}$') { continue }
        $rows.Add([pscustomobject]@{
            WorkPackage=[string]$cells[0]; TaskId=[string]$cells[1]; Role=([string]$cells[3]).ToUpperInvariant()
            Dependencies=[string]$cells[7]; State=([string]$cells[8]).ToLowerInvariant(); ReviewTask=([string]$cells[11]).Trim('`')
            ReviewState=([string]$cells[12]).ToLowerInvariant(); ReviewEvidence=([string]$cells[13]).Trim('`')
        })
    }
    return @($rows)
}

function Get-ReviewEvidencePaths([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '^(?i:n/?a|-)$') { return @() }
    return @($Value -split '\s*,\s*' | ForEach-Object { ([string]$_).Trim().Trim('`') } | Where-Object { $_ } | Select-Object -Unique)
}

function Update-TeamLedgerReview([string]$TaskId, [string]$Status, [string]$Evidence, [string]$ReviewerTaskId = '') {
    $governance = Read-GovernanceJson -Path $governancePath
    if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { return }
    $ledgerRelative = [string]$governance.authoritative_documents.task_ledger
    $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root $ledgerRelative))
    $content = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
    $lines = $content -split "\r?\n"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -notmatch '^\s*\|(.+)\|\s*$') { continue }
        $cells = @($Matches[1] -split '\|' | ForEach-Object { $_.Trim() })
        if ($cells.Count -lt 15 -or $cells[1] -ne $TaskId) { continue }
        if (-not [string]::IsNullOrWhiteSpace($ReviewerTaskId)) { $cells[11] = $ReviewerTaskId }
        $cells[12] = $Status
        $cells[13] = $Evidence
        $lines[$index] = '| ' + ($cells -join ' | ') + ' |'
        $found = $true
        break
    }
    if (-not $found) { throw "TEAM_PROJECT task ledger does not contain $TaskId." }
    Write-AtomicUtf8Text -Path $ledgerPath -Content (($lines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine)
}

function Register-TeamLedgerTask($Contract, [string]$InitialReviewerTaskId = '') {
    $governance = Read-GovernanceJson -Path $governancePath
    if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { return }
    $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
    $content = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
    $lines = @($content -split "\r?\n")
    $taskId = [string]$Contract.task_id
    if (@($lines | Where-Object { $_ -match "^\s*\|\s*[^|]+\s*\|\s*$([regex]::Escape($taskId))\s*\|" }).Count -gt 0) { return }
    $headerIndex = -1
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match '^\s*\|\s*工作包\s*\|\s*独立任务标识\s*\|') { $headerIndex = $index; break }
    }
    if ($headerIndex -lt 0 -or $headerIndex + 1 -ge $lines.Count -or $lines[$headerIndex + 1] -notmatch '^\s*\|\s*:?-{3,}') { throw 'TEAM_PROJECT task ledger does not contain the standard task table.' }
    $cleanCell = {
        param([string]$Value, [string]$Fallback = 'n/a')
        if ([string]::IsNullOrWhiteSpace($Value)) { return $Fallback }
        return (($Value -replace '[\r\n]+', ' ' -replace '\|', '/') -replace '\s+', ' ').Trim()
    }
    $role = [string]$Contract.role
    $dependencies = @($Contract.dependencies | ForEach-Object { [string]$_ })
    $validationIds = @($Contract.validations | ForEach-Object { [string]$_.id })
    $deliverables = @($Contract.write_paths)
    if ($deliverables.Count -eq 0) { $deliverables = @($Contract.allowed_paths) }
    $reviewTask = if ($role -eq 'REVIEWER') { 'n/a' } elseif ($InitialReviewerTaskId) { $InitialReviewerTaskId } else { 'pending' }
    $reviewState = if ($role -eq 'REVIEWER') { 'n/a' } else { 'pending' }
    $reviewEvidence = if ($role -eq 'REVIEWER') { 'n/a' } else { 'pending' }
    $cells = @(
        (& $cleanCell ([string]$Contract.work_package)), $taskId, 'pending', (& $cleanCell $role), (& $cleanCell ([string]$Contract.title)),
        (& $cleanCell ([string]$Contract.baseline)), 'pending', (& $cleanCell ($dependencies -join ', ')), 'pending',
        (& $cleanCell ($deliverables -join ', ')), (& $cleanCell ($validationIds -join ', ')), $reviewTask, $reviewState, $reviewEvidence, 'Plan 自动登记，等待调度'
    )
    $row = '| ' + ($cells -join ' | ') + ' |'
    $insertIndex = $headerIndex + 2
    $updatedLines = @($lines[0..($insertIndex - 1)]) + @($row) + @($lines[$insertIndex..($lines.Count - 1)])
    Write-AtomicUtf8Text -Path $ledgerPath -Content (($updatedLines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine)
}

function Update-TeamLedgerTaskState([string]$TaskId, [string]$RuntimeState, [string]$LedgerState = '') {
    $governance = Read-GovernanceJson -Path $governancePath
    if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { return }
    $stateMap = @{
        'planned'='pending'; 'in-progress'='running'; 'implemented'='running'; 'verified'='running'
        'accepted'='completed'; 'blocked'='needs-attention'; 'needs-decision'='needs-attention'; 'superseded'='replaced'
    }
    $nextState = if ($LedgerState) { $LedgerState } elseif ($stateMap.ContainsKey($RuntimeState)) { $stateMap[$RuntimeState] } else { return }
    $ledgerRelative = [string]$governance.authoritative_documents.task_ledger
    $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root $ledgerRelative))
    $content = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
    $lines = $content -split "\r?\n"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -notmatch '^\s*\|(.+)\|\s*$') { continue }
        $cells = @($Matches[1] -split '\|' | ForEach-Object { $_.Trim() })
        if ($cells.Count -lt 15 -or $cells[1] -ne $TaskId) { continue }
        $cells[8] = $nextState
        $lines[$index] = '| ' + ($cells -join ' | ') + ' |'
        $found = $true
        break
    }
    if (-not $found) { throw "TEAM_PROJECT task ledger does not contain $TaskId." }
    Write-AtomicUtf8Text -Path $ledgerPath -Content (($lines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine)
}

function Read-ReviewEvidence([string]$Path, [string]$ReviewerId, [string]$ExpectedResult) {
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $root $Path))
    $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    $evidencePrefix = [System.IO.Path]::GetFullPath((Join-Path $root "docs/05-quality/evidence/$ReviewerId")) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($rootPrefix, $script:GovernancePathComparison) -or -not $resolved.StartsWith($evidencePrefix, $script:GovernancePathComparison) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Review evidence is missing or outside the reviewer evidence directory: $Path" }
    try { $evidence = [System.IO.File]::ReadAllText($resolved, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop } catch { throw "Review evidence is not valid JSON: $Path" }
    if ([string]$evidence.'$schema' -ne 'schemas/review-evidence.schema.json' -or [int]$evidence.schema_version -ne 1 -or [string]$evidence.reviewer_task_id -ne $ReviewerId -or [string]$evidence.result -ne $ExpectedResult -or @($evidence.reviewed_task_ids).Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$evidence.work_package) -or [string]::IsNullOrWhiteSpace([string]$evidence.baseline) -or @($evidence.scope_checked).Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$evidence.change_summary)) { throw "Review evidence does not satisfy the review-evidence schema: $Path" }
    if ($ExpectedResult -in @('passed', 'changes-required') -and (-not [bool]$evidence.diff_checked -or @($evidence.changes).Count -eq 0)) { throw "Review evidence must include diff_checked=true and a non-empty changes manifest: $Path" }
    foreach ($change in @($evidence.changes)) {
        if ([string]$change.task_id -notmatch '^TASK-\d{3,}$' -or [string]::IsNullOrWhiteSpace([string]$change.path) -or [string]$change.change_type -notin @('added', 'modified', 'deleted', 'renamed') -or [string]::IsNullOrWhiteSpace([string]$change.summary)) { throw "Review evidence contains an invalid change entry: $Path" }
        if ([string]$change.change_type -eq 'renamed' -and [string]::IsNullOrWhiteSpace([string]$change.old_path)) { throw "Renamed review evidence must include old_path: $Path" }
        if ([string]$change.change_type -ne 'renamed' -and -not [string]::IsNullOrWhiteSpace([string]$change.old_path)) { throw "Only renamed review evidence may include old_path: $Path" }
    }
    return [pscustomobject]@{ Path=$Path; Value=$evidence }
}

function Assert-ReviewChangeManifest($Evidence, [string]$ReviewedTaskId, $ReviewedPair, [string]$ExpectedResult) {
    if ([string]$Evidence.work_package -ne [string]$ReviewedPair.Contract.work_package -or [string]$Evidence.baseline -ne [string]$ReviewedPair.Contract.baseline -or $ReviewedTaskId -notin @($Evidence.reviewed_task_ids)) { throw "Review evidence is not bound to task $ReviewedTaskId, work package $($ReviewedPair.Contract.work_package), and baseline $($ReviewedPair.Contract.baseline)." }
    if ($ExpectedResult -eq 'cancelled') { return }
    $entries = @($Evidence.changes | Where-Object { [string]$_.task_id -eq $ReviewedTaskId })
    if ($entries.Count -eq 0) { throw "Review evidence must list an actual change for reviewed task $ReviewedTaskId." }
    $writePaths = @(Get-TaskWritePaths $ReviewedPair.Contract)
    $declaredEntries = [System.Collections.Generic.HashSet[string]]::new($script:GovernancePathComparer)
    foreach ($entry in $entries) {
        $path = ([string]$entry.path).Replace('\', '/').Trim('/')
        if ([string]::IsNullOrWhiteSpace($path) -or @($writePaths | Where-Object { Test-PathWithin $path ([string]$_) }).Count -eq 0) { throw "Review change is outside the reviewed task write scope: $ReviewedTaskId -> $path" }
        if (Test-SystemPath $path $ReviewedTaskId ([string]$ReviewedPair.Contract.work_package)) { throw "Review evidence for $ReviewedTaskId lists a governance or automated evidence artifact as a substantive change: $path" }
        $changeType = [string]$entry.change_type
        $oldPath = ([string]$entry.old_path).Replace('\', '/').Trim('/')
        if ($changeType -eq 'renamed') {
            if ([string]::IsNullOrWhiteSpace($oldPath) -or @($writePaths | Where-Object { Test-PathWithin $oldPath ([string]$_) }).Count -eq 0) { throw "Renamed review change must include an old_path inside the reviewed task write scope: $ReviewedTaskId -> $path" }
            [void]$declaredEntries.Add("renamed|$oldPath|$path")
        } else {
            if (-not [string]::IsNullOrWhiteSpace($oldPath)) { throw "Only renamed review changes may declare old_path: $ReviewedTaskId -> $path" }
            [void]$declaredEntries.Add("$changeType|$path")
        }
    }
    $actualEntries = @(
        Get-ChangedEntries -BaseCommit ([string]$ReviewedPair.State.start_git_commit) |
            Where-Object {
                $candidatePath = ([string]$_.path).Replace('\', '/').Trim('/')
                $candidateOldPath = ([string]$_.old_path).Replace('\', '/').Trim('/')
                $pathInScope = @($writePaths | Where-Object { Test-PathWithin $candidatePath ([string]$_) -or ($candidateOldPath -and (Test-PathWithin $candidateOldPath ([string]$_))) }).Count -gt 0
                $meaningful = -not (Test-SystemPath $candidatePath $ReviewedTaskId ([string]$ReviewedPair.Contract.work_package)) -or ($candidateOldPath -and -not (Test-SystemPath $candidateOldPath $ReviewedTaskId ([string]$ReviewedPair.Contract.work_package)))
                $pathInScope -and $meaningful
            }
    )
    if ($actualEntries.Count -eq 0) { throw "Reviewed task $ReviewedTaskId has no substantive Git changes since its start commit." }
    $actualEntriesSet = [System.Collections.Generic.HashSet[string]]::new($script:GovernancePathComparer)
    foreach ($actualEntry in $actualEntries) {
        $actualPath = ([string]$actualEntry.path).Replace('\', '/').Trim('/')
        $actualOldPath = ([string]$actualEntry.old_path).Replace('\', '/').Trim('/')
        $key = if ([string]$actualEntry.change_type -eq 'renamed') { "renamed|$actualOldPath|$actualPath" } else { "$($actualEntry.change_type)|$actualPath" }
        [void]$actualEntriesSet.Add($key)
    }
    $missingFromEvidence = @($actualEntriesSet | Where-Object { -not $declaredEntries.Contains([string]$_) })
    $notInGitDiff = @($declaredEntries | Where-Object { -not $actualEntriesSet.Contains([string]$_) })
    if ($missingFromEvidence.Count -gt 0 -or $notInGitDiff.Count -gt 0) { throw "Review change manifest does not match the actual Git diff for $ReviewedTaskId, including change types. Missing: $($missingFromEvidence -join ', '); not in diff: $($notInGitDiff -join ', ')." }
}

function Get-ReviewSubjectSha256($ReviewedPair, [string]$ReviewedTaskId) {
    $writePaths = @(Get-TaskWritePaths $ReviewedPair.Contract)
    $actualEntries = @(
        Get-ChangedEntries -BaseCommit ([string]$ReviewedPair.State.start_git_commit) |
            Where-Object {
                $candidatePath = ([string]$_.path).Replace('\', '/').Trim('/')
                $candidateOldPath = ([string]$_.old_path).Replace('\', '/').Trim('/')
                $pathInScope = @($writePaths | Where-Object { Test-PathWithin $candidatePath ([string]$_) -or ($candidateOldPath -and (Test-PathWithin $candidateOldPath ([string]$_))) }).Count -gt 0
                $meaningful = -not (Test-SystemPath $candidatePath $ReviewedTaskId ([string]$ReviewedPair.Contract.work_package)) -or ($candidateOldPath -and -not (Test-SystemPath $candidateOldPath $ReviewedTaskId ([string]$ReviewedPair.Contract.work_package)))
                $pathInScope -and $meaningful
            }
    )
    if ($actualEntries.Count -eq 0) { throw "Reviewed task $ReviewedTaskId has no substantive Git changes to fingerprint." }
    return Get-GovernanceGitEntriesSha256 -ProjectRoot $root -Entries $actualEntries
}

function Get-AcceptanceSnapshot($TaskPair, [string]$Id) {
    $evidencePaths = @($TaskPair.State.evidence | ForEach-Object { [string]$_ } | Where-Object { $_ })
    if ($evidencePaths.Count -ne @($TaskPair.Contract.validations).Count) { throw "Task $Id does not have a complete current validation evidence set." }
    return [pscustomobject]@{
        SubjectSha256 = Get-ReviewSubjectSha256 $TaskPair $Id
        EvidenceSha256 = Get-GovernanceFileSetSha256 -ProjectRoot $root -RelativePaths $evidencePaths
    }
}

function Assert-TeamReviewPassed([string]$Id) {
    $governance = Read-GovernanceJson -Path $governancePath
    if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { return }
    $rows = @(Get-TeamLedgerRows)
    $deliveryRows = @($rows | Where-Object TaskId -eq $Id)
    if ($deliveryRows.Count -ne 1) { throw "TEAM_PROJECT task $Id must be registered exactly once in the task ledger." }
    $delivery = $deliveryRows[0]
    if ($delivery.Role -eq 'REVIEWER') { return }
    if ($delivery.ReviewTask -notmatch '^TASK-\d{3,}$' -or $delivery.ReviewTask -eq $Id) { throw "TEAM_PROJECT task $Id does not have an independent reviewer task." }
    $deliveryPair = Read-TaskPair $Id
    $stateReview = Get-Property $deliveryPair.State 'review'
    $requiredReviewRounds = Get-RequiredReviewRounds $deliveryPair.Contract
    if ([string](Get-Property $stateReview 'reviewer_task_id') -ne $delivery.ReviewTask -or [string](Get-Property $stateReview 'status') -ne 'passed' -or [int](Get-Property $stateReview 'pass_streak') -lt $requiredReviewRounds) { throw "TEAM_PROJECT task $Id requires $requiredReviewRounds passed review round(s)." }
    $currentSubjectHash = Get-ReviewSubjectSha256 $deliveryPair $Id
    if ([string](Get-Property $stateReview 'subject_sha256') -ne $currentSubjectHash) { throw "TEAM_PROJECT task $Id changed after its consecutive passed review rounds." }
    $reviewerRows = @($rows | Where-Object TaskId -eq $delivery.ReviewTask)
    if ($reviewerRows.Count -ne 1 -or $reviewerRows[0].Role -ne 'REVIEWER' -or $reviewerRows[0].WorkPackage -ne $delivery.WorkPackage) { throw "TEAM_PROJECT task $Id reviewer is missing, not independent, or belongs to another work package." }
    if ($delivery.ReviewState -ne 'passed' -or $reviewerRows[0].State -ne 'completed') { throw "TEAM_PROJECT task $Id cannot be accepted before independent review passes." }
    $reviewerPair = Read-TaskPair $delivery.ReviewTask
    if ([string]$reviewerPair.State.state -ne 'verified') { throw "Reviewer task $($delivery.ReviewTask) must remain verified and cannot be accepted independently." }
    $matchingPassedRounds = [System.Collections.Generic.HashSet[string]]::new($script:GovernancePathComparer)
    foreach ($historyEntry in @($reviewerPair.State.review_history | Where-Object { [string]$_.result -eq 'passed' })) {
        $historyPath = [string]$historyEntry.path
        $historyRoundId = [string](Get-Property $historyEntry 'round_id')
        if ($historyRoundId -notmatch '^RR-[0-9a-f]{32}$') { continue }
        try { $historyRecord = Read-ReviewEvidence $historyPath $delivery.ReviewTask 'passed' } catch { continue }
        if ($Id -in @($historyRecord.Value.reviewed_task_ids) -and [string]$historyRecord.Value.work_package -eq $delivery.WorkPackage -and [string]$historyRecord.Value.baseline -eq [string]$deliveryPair.Contract.baseline) { [void]$matchingPassedRounds.Add($historyRoundId) }
    }
    if ($matchingPassedRounds.Count -lt $requiredReviewRounds) { throw "TEAM_PROJECT task $Id does not have $requiredReviewRounds distinct passed review evidence round(s)." }
    $evidencePaths = @(Get-ReviewEvidencePaths $delivery.ReviewEvidence)
    if ($evidencePaths.Count -eq 0) { throw "TEAM_PROJECT task $Id has no review evidence paths." }
    $matchingEvidence = 0
    foreach ($reviewEvidencePath in $evidencePaths) {
        if ($reviewEvidencePath -notin @($reviewerPair.State.evidence_history)) { throw "TEAM_PROJECT task $Id review evidence is not recorded by reviewer task $($delivery.ReviewTask): $reviewEvidencePath" }
        $historyEntry = @($reviewerPair.State.review_history | Where-Object { [string]$_.path -eq $reviewEvidencePath })
        $resolvedReviewPath = [System.IO.Path]::GetFullPath((Join-Path $root $reviewEvidencePath))
        $currentReviewHash = if (Test-Path -LiteralPath $resolvedReviewPath -PathType Leaf) { (Get-FileHash -LiteralPath $resolvedReviewPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }
        if ($historyEntry.Count -ne 1 -or [string]$historyEntry[0].sha256 -ne $currentReviewHash) { throw "TEAM_PROJECT task $Id review evidence is missing from immutable review history or has changed: $reviewEvidencePath" }
        $record = Read-ReviewEvidence $reviewEvidencePath $delivery.ReviewTask 'passed'
        if ($Id -in @($record.Value.reviewed_task_ids)) {
            Assert-ReviewChangeManifest $record.Value $Id $deliveryPair 'passed'
            $matchingEvidence++
        }
    }
    if ($matchingEvidence -eq 0) { throw "TEAM_PROJECT task $Id has no review evidence bound to the task." }
}

function Write-State($Pair) {
    $Pair.State.updated_at = (Get-Date).ToUniversalTime().ToString('o')
    $ownsJournal = -not (Test-Path -LiteralPath $transactionJournalPath -PathType Leaf)
    $stateSnapshot = if (Test-Path -LiteralPath $Pair.Paths.State -PathType Leaf) { [System.IO.File]::ReadAllText($Pair.Paths.State, $script:GovernanceUtf8NoBom) } else { $null }
    $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
    $governance = Read-GovernanceJson -Path $governancePath
    $ledgerPath = ''
    $ledgerSnapshot = $null
    if ([string]$governance.project.mode -eq 'TEAM_PROJECT') {
        $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
        $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
    }
    $journalEntries = [System.Collections.Generic.List[object]]::new()
    foreach ($snapshot in @(
        [pscustomobject]@{ Path=$Pair.Paths.State; Content=$stateSnapshot },
        [pscustomobject]@{ Path=$workStatusPath; Content=$workStatusSnapshot },
        [pscustomobject]@{ Path=$ledgerPath; Content=$ledgerSnapshot }
    )) {
        if ($snapshot.Path -and $null -ne $snapshot.Content) { $journalEntries.Add([ordered]@{ path=[System.IO.Path]::GetFullPath([string]$snapshot.Path); existed=$true; content_base64=[Convert]::ToBase64String($script:GovernanceUtf8NoBom.GetBytes([string]$snapshot.Content)) }) }
    }
    if ($ownsJournal) {
        Write-GovernanceJson -Path $transactionJournalPath -Value ([ordered]@{ schema_version=1; project_root=$root; status='pending'; created_at=(Get-Date).ToUniversalTime().ToString('o'); files=@($journalEntries) })
    }
    try {
        Update-TeamLedgerTaskState -TaskId ([string]$Pair.State.task_id) -RuntimeState ([string]$Pair.State.state)
        Write-GovernanceJson -Path $Pair.Paths.State -Value $Pair.State
        Sync-WorkPackageStatus -Id ([string]$Pair.Contract.work_package)
        if ($ownsJournal) { Remove-Item -LiteralPath $transactionJournalPath -Force }
    } catch {
        if ($null -ne $stateSnapshot) { Write-AtomicUtf8Text -Path $Pair.Paths.State -Content $stateSnapshot }
        if ($null -ne $ledgerSnapshot) { Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot }
        Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
        if ($ownsJournal -and (Test-Path -LiteralPath $transactionJournalPath -PathType Leaf)) { Remove-Item -LiteralPath $transactionJournalPath -Force }
        throw
    }
}

function Recover-PendingGovernanceTransaction {
    if (-not (Test-Path -LiteralPath $transactionJournalPath -PathType Leaf)) { return }
    $journal = [System.IO.File]::ReadAllText($transactionJournalPath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop
    if ([string]$journal.project_root -ne $root -or [string]$journal.status -ne 'pending') { throw "Governance transaction journal does not match the current project: $transactionJournalPath" }
    $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    foreach ($entry in @($journal.files)) {
        $target = [System.IO.Path]::GetFullPath([string]$entry.path)
        if (-not $target.StartsWith($rootPrefix, $script:GovernancePathComparison)) { throw "Governance transaction journal contains an out-of-project target: $target" }
        if ([string](Get-Property $entry 'existed') -eq 'False') {
            if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
        } else {
            $content = $script:GovernanceUtf8NoBom.GetString([Convert]::FromBase64String([string]$entry.content_base64))
            Write-AtomicUtf8Text -Path $target -Content $content
        }
    }
    Remove-Item -LiteralPath $transactionJournalPath -Force
}

function Start-GovernanceActionTransaction {
    if (Test-Path -LiteralPath $transactionJournalPath -PathType Leaf) { throw "A governance transaction is already active: $transactionJournalPath" }
    $governance = Read-GovernanceJson -Path $governancePath
    $paths = [System.Collections.Generic.List[string]]::new()
    foreach ($statePath in @(Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'TASK-*.state.json' -ErrorAction SilentlyContinue)) { $paths.Add($statePath.FullName) }
    $paths.Add($workStatusPath)
    $paths.Add($approvalLogPath)
    if ([string]$governance.project.mode -eq 'TEAM_PROJECT') {
        $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
        $paths.Add($ledgerPath)
    }
    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($path in @($paths | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Governance transaction source is missing: $path" }
        $content = [System.IO.File]::ReadAllText($path, $script:GovernanceUtf8NoBom)
        $entries.Add([ordered]@{ path=[System.IO.Path]::GetFullPath($path); existed=$true; content_base64=[Convert]::ToBase64String($script:GovernanceUtf8NoBom.GetBytes($content)) })
    }
    Write-GovernanceJson -Path $transactionJournalPath -Value ([ordered]@{ schema_version=1; project_root=$root; status='pending'; created_at=(Get-Date).ToUniversalTime().ToString('o'); files=@($entries) })
}

function Set-ExecutionLease($Pair, [string]$Owner, [int]$Hours = 2) {
    if ([string]::IsNullOrWhiteSpace($Owner)) { throw 'Starting or resuming active execution requires LeaseOwner.' }
    $Pair.State.execution_lease = [guid]::NewGuid().ToString('N')
    Set-ObjectProperty -Object $Pair.State -Name 'execution_lease_owner' -Value $Owner.Trim()
    Set-ObjectProperty -Object $Pair.State -Name 'execution_lease_expires_at' -Value ([DateTime]::UtcNow.AddHours($Hours).ToString('o'))
}

function Clear-ExecutionLease($Pair) {
    $Pair.State.execution_lease = ''
    Set-ObjectProperty -Object $Pair.State -Name 'execution_lease_owner' -Value ''
    Set-ObjectProperty -Object $Pair.State -Name 'execution_lease_expires_at' -Value ''
}

function Upgrade-TaskStateSchemaV2($Pair, $Governance) {
    $Pair.State.schema_version = 2
    foreach ($propertyName in @('acceptance_subject_sha256', 'acceptance_evidence_sha256', 'acceptance_git_commit', 'execution_lease_owner', 'execution_lease_expires_at')) {
        if ($null -eq $Pair.State.PSObject.Properties[$propertyName]) { Set-ObjectProperty -Object $Pair.State -Name $propertyName -Value '' }
    }
    $reviewHistoryWasMissing = $null -eq $Pair.State.PSObject.Properties['review_history']
    foreach ($arrayName in @('evidence_history', 'review_history')) {
        if ($null -eq $Pair.State.PSObject.Properties[$arrayName]) { Set-ObjectProperty -Object $Pair.State -Name $arrayName -Value @() }
    }
    if ($reviewHistoryWasMissing) {
        $migratedReviewHistory = [System.Collections.Generic.List[object]]::new()
        foreach ($evidencePath in @($Pair.State.evidence_history | ForEach-Object { [string]$_ } | Where-Object { $_ })) {
            $resolvedEvidencePath = [System.IO.Path]::GetFullPath((Join-Path $root $evidencePath))
            $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
            if (-not $resolvedEvidencePath.StartsWith($rootPrefix, $script:GovernancePathComparison) -or -not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) { continue }
            try { $legacyEvidence = [System.IO.File]::ReadAllText($resolvedEvidencePath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop } catch { continue }
            if ([string](Get-Property $legacyEvidence '$schema') -ne 'schemas/review-evidence.schema.json' -or [string](Get-Property $legacyEvidence 'result') -notin @('passed', 'changes-required', 'cancelled')) { continue }
            $migratedReviewHistory.Add([pscustomobject][ordered]@{
                path=$evidencePath
                sha256=(Get-FileHash -LiteralPath $resolvedEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant()
                result=[string]$legacyEvidence.result
                recorded_at=(Get-Date).ToUniversalTime().ToString('o')
            })
        }
        $Pair.State.review_history = @($migratedReviewHistory)
    }
    if ([string]$Pair.State.state -ne 'in-progress') { Clear-ExecutionLease $Pair }
    $role = [string](Get-Property $Pair.Contract 'role')
    $isTeam = [string]$Governance.project.mode -eq 'TEAM_PROJECT'
    $review = Get-Property $Pair.State 'review'
    if ($null -eq $review) {
        $legacyReviewerId = [string](Get-Property (Get-Property $Pair.Contract 'review') 'reviewer_task_id')
        $reviewerId = if ($legacyReviewerId -match '^TASK-\d{3,}$') { $legacyReviewerId } else { '' }
        $review = [pscustomobject][ordered]@{ required=($isTeam -and $role -ne 'REVIEWER'); reviewer_task_id=$reviewerId; status=$(if ($isTeam -and $role -ne 'REVIEWER' -and $reviewerId) { 'changes-required' } elseif ($isTeam -and $role -ne 'REVIEWER') { 'unassigned' } else { 'not-applicable' }); evidence=@(); pass_streak=0; subject_sha256='' }
        Set-ObjectProperty -Object $Pair.State -Name 'review' -Value $review
    }
    if ($null -eq $review.PSObject.Properties['required']) { Set-ObjectProperty -Object $review -Name 'required' -Value ($isTeam -and $role -ne 'REVIEWER') }
    if ($null -eq $review.PSObject.Properties['reviewer_task_id']) { Set-ObjectProperty -Object $review -Name 'reviewer_task_id' -Value '' }
    if ($null -eq $review.PSObject.Properties['status']) { Set-ObjectProperty -Object $review -Name 'status' -Value $(if ($isTeam -and $role -ne 'REVIEWER') { 'changes-required' } else { 'not-applicable' }) }
    if ($null -eq $review.PSObject.Properties['evidence']) { Set-ObjectProperty -Object $review -Name 'evidence' -Value @() }
    if ($null -eq $review.PSObject.Properties['pass_streak']) { Set-ObjectProperty -Object $review -Name 'pass_streak' -Value 0 }
    if ($null -eq $review.PSObject.Properties['subject_sha256']) { Set-ObjectProperty -Object $review -Name 'subject_sha256' -Value '' }
    if ($role -eq 'REVIEWER' -or -not $isTeam) {
        $review.required = $false; $review.reviewer_task_id = ''; $review.status = 'not-applicable'; $review.evidence = @(); $review.pass_streak = 0; $review.subject_sha256 = ''
    }
}

function Assert-ExecutionLeaseLive($Pair, [string]$SuppliedLeaseId, [string]$SuppliedOwner) {
    $lease = [string](Get-Property $Pair.State 'execution_lease')
    $owner = [string](Get-Property $Pair.State 'execution_lease_owner')
    $rawExpiry = Get-Property $Pair.State 'execution_lease_expires_at'
    $expires = [DateTimeOffset]::MinValue
    $validExpiry = if ($rawExpiry -is [DateTime]) { $expires = [DateTimeOffset]::new(([DateTime]$rawExpiry).ToUniversalTime()); $true } else { [DateTimeOffset]::TryParse([string]$rawExpiry, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$expires) }
    if ([string]::IsNullOrWhiteSpace($lease) -or [string]::IsNullOrWhiteSpace($owner) -or -not $validExpiry -or $expires -le [DateTimeOffset]::UtcNow) {
        $Pair.State.state = 'needs-decision'; Clear-ExecutionLease $Pair; $Pair.State.last_error = "Task $($Pair.State.task_id) execution lease expired; recover or re-plan before continuing."; Write-State $Pair; throw $Pair.State.last_error
    }
    if ($SuppliedLeaseId -ne $lease -or $SuppliedOwner -ne $owner) { throw "Task $($Pair.State.task_id) execution lease is owned by another coordinator." }
}

function Set-WorkPackageStatus([string]$Id, [string]$Status, [string]$Evidence = "待生成") {
    $content = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
    $match = [regex]::Match($content, "(?m)^\|\s*$([regex]::Escape($Id))\s*\|.*$")
    if (-not $match.Success) { throw "WORK-STATUS.md does not contain $Id." }
    $cells = $match.Value.Split('|')
    if ($cells.Count -lt 8) { throw "WORK-STATUS.md row is malformed for $Id." }
    $cells[2] = " $Status "
    $cells[3] = " $(Get-Date -Format 'yyyy-MM-dd') "
    $cells[5] = " $($Evidence.Replace('|', '/')) "
    $updated = $content.Remove($match.Index, $match.Length).Insert($match.Index, ($cells -join '|'))
    Write-AtomicUtf8Text -Path $workStatusPath -Content $updated
}

function Sync-WorkPackageStatus([string]$Id) {
    $states = [System.Collections.Generic.List[object]]::new()
    foreach ($statePath in @(Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'TASK-*.state.json' -ErrorAction SilentlyContinue)) {
        try { $candidate = [System.IO.File]::ReadAllText($statePath.FullName, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop } catch { continue }
        if ([string]$candidate.work_package -eq $Id) { $states.Add($candidate) }
    }
    if ($states.Count -eq 0) { return }
    $values = @($states | ForEach-Object {
        $stateValue = [string]$_.state
        $stateTaskId = [string]$_.task_id
        $stateRole = try { [string](Read-TaskPair $stateTaskId).Contract.role } catch { '' }
        if ($stateRole -eq 'REVIEWER' -and $stateValue -eq 'verified') { 'accepted' } else { $stateValue }
    })
    $status = if ('needs-decision' -in $values) { 'needs-decision' }
        elseif ('blocked' -in $values) { 'blocked' }
        elseif ('in-progress' -in $values) { 'in-progress' }
        elseif ('implemented' -in $values) { 'implemented' }
        elseif (@($values | Where-Object { $_ -ne 'superseded' }).Count -eq 0) { 'superseded' }
        elseif (@($values | Where-Object { $_ -notin @('accepted', 'superseded') }).Count -eq 0) { 'accepted' }
        elseif (@($values | Where-Object { $_ -notin @('verified', 'accepted', 'superseded') }).Count -eq 0) { 'verified' }
        else { 'planned' }
    $evidence = @($states | ForEach-Object { @($_.evidence) } | Where-Object { $_ } | Select-Object -Unique)
    Set-WorkPackageStatus -Id $Id -Status $status -Evidence $(if ($evidence.Count) { $evidence -join ', ' } else { '待生成' })
}

function Assert-Approval([string]$Id, [string]$PlanHash, [string]$Baseline, [string]$Type, [string]$Approval, [string]$SubjectSha256 = '', [string]$EvidenceSha256 = '') {
    if ([string]::IsNullOrWhiteSpace($Approval)) { throw "$Type approval is required for $Id and plan $PlanHash." }
    $log = [System.IO.File]::ReadAllText($approvalLogPath, $script:GovernanceUtf8NoBom)
    $blockMatch = [regex]::Match($log, "(?ms)^\s*approval_id:\s*$([regex]::Escape($Approval))\s*$.*?(?=^\s*approval_id:\s*APR-|\z)")
    if (-not $blockMatch.Success) { throw "Approval $Approval is not recorded." }
    $block = $blockMatch.Value
    if ($block -notmatch '(?m)^\s*status:\s*approved\s*$' -or $block -notmatch "(?m)^\s*approval_type:\s*$([regex]::Escape($Type))\s*$" -or $block -notmatch "(?m)^\s*-\s*$([regex]::Escape($Id))\s*$" -or $block -notmatch "(?m)^\s*plan_sha256:\s*$([regex]::Escape($PlanHash))\s*$" -or $block -notmatch "(?m)^\s*baseline:\s*$([regex]::Escape($Baseline))\s*$") {
        throw "Approval $Approval is not bound to $Type, $Id, baseline $Baseline, and plan $PlanHash."
    }
    if ($block -notmatch '(?m)^\s*confirmation_id:\s*CONF-[A-Za-z0-9][A-Za-z0-9._:-]{5,127}\s*$') { throw "Approval $Approval is not bound to an explicit user confirmation reference." }
    if ($Type -eq 'acceptance' -and ($SubjectSha256 -notmatch '^[0-9a-f]{64}$' -or $EvidenceSha256 -notmatch '^[0-9a-f]{64}$' -or $block -notmatch "(?m)^\s*subject_sha256:\s*$([regex]::Escape($SubjectSha256))\s*$" -or $block -notmatch "(?m)^\s*evidence_sha256:\s*$([regex]::Escape($EvidenceSha256))\s*$")) {
        throw "Approval $Approval is not bound to the final verified content and evidence for $Id."
    }
    $expiresMatch = [regex]::Match($block, '(?m)^\s*expires_at:\s*(.*?)\s*$')
    if (-not $expiresMatch.Success) { throw "Approval $Approval does not declare expires_at." }
    $expiresValue = $expiresMatch.Groups[1].Value.Trim()
    if ($expiresValue -notin @('null', '~', '')) {
        $expiresAt = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse($expiresValue, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$expiresAt) -or $expiresAt -le [DateTimeOffset]::UtcNow) { throw "Approval $Approval is expired or has an invalid expires_at value." }
    }
}

function Invoke-StrictValidation([string]$TaskProfile = '', [switch]$AllowLegacyTaskStates) {
    $validator = Join-Path $PSScriptRoot 'Test-ProjectGovernance.ps1'
    $hostExecutable = if ($PSVersionTable.PSEdition -eq 'Core') { (Get-Process -Id $PID).Path } else { 'powershell.exe' }
    $level = Get-ProfileValidationLevel $TaskProfile
    $validatorArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $validator, '-ProjectPath', $root, '-Level', $level)
    if ($AllowLegacyTaskStates) { $validatorArguments += '-AllowLegacyTaskStates' }
    $output = & $hostExecutable @validatorArguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "$level governance validation failed before or after execution:`n$output" }
}

function Assert-NoActiveScopeOverlap($Pair) {
    foreach ($otherStatePath in @(Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'TASK-*.state.json' -ErrorAction SilentlyContinue)) {
        if ($otherStatePath.Name -eq "$($Pair.Contract.task_id).state.json") { continue }
        $otherState = [System.IO.File]::ReadAllText($otherStatePath.FullName, $script:GovernanceUtf8NoBom) | ConvertFrom-Json
        if ([string]$otherState.state -ne 'in-progress') { continue }
        $otherPair = Read-TaskPair ([string]$otherState.task_id)
        foreach ($left in @(Get-TaskWritePaths $Pair.Contract)) {
            foreach ($right in @(Get-TaskWritePaths $otherPair.Contract)) {
                if (Test-ScopesOverlap ([string]$left) ([string]$right)) { throw "Task $($Pair.Contract.task_id) overlaps active task $($otherState.task_id): $left / $right" }
            }
        }
    }
}

if ($Action -eq 'Plan') {
    foreach ($value in @($WorkPackage, $Title, $Goal)) { if ([string]::IsNullOrWhiteSpace([string]$value)) { throw "Plan requires WorkPackage, Title, and Goal." } }
    if ($AllowedPath.Count -eq 0 -or $AcceptanceCriterion.Count -eq 0 -or ($ValidationJson.Count -eq 0 -and [string]::IsNullOrWhiteSpace($ValidationCommand))) { throw "Plan requires allowed paths, acceptance criteria, and validations." }
    $governance = Read-GovernanceJson -Path $governancePath
    if ([string]::IsNullOrWhiteSpace($Profile)) { $Profile = [string]$governance.task_profile }
    $baseline = [string]$governance.current_baseline
    $statusContent = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
    $statusMatch = [regex]::Match($statusContent, "(?m)^\|\s*$([regex]::Escape($WorkPackage))\s*\|\s*([^|]+)\|")
    if (-not $statusMatch.Success) { throw "WORK-STATUS.md does not contain $WorkPackage." }
    if ($statusMatch.Groups[1].Value.Trim().ToLowerInvariant() -in @('accepted', 'superseded')) { throw "$WorkPackage is terminal; create or reassess a work package before planning more execution." }
    $routePath = Join-Path $root "docs/04-delivery/context/$WorkPackage.context.json"
    if (-not (Test-Path -LiteralPath $routePath -PathType Leaf)) { throw "No current context route exists for $WorkPackage. AI must create or reassess the work package before execution." }
    $route = [System.IO.File]::ReadAllText($routePath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop
    if ([string]$route.baseline -ne $baseline) { throw "Work-package context route is not bound to current baseline $baseline." }
    $routeScopes = @($route.scope | ForEach-Object { Normalize-RelativePath ([string]$_) })
    $allowed = @($AllowedPath | ForEach-Object { Normalize-RelativePath ([string]$_) } | Select-Object -Unique)
    $readPaths = if ($ReadPath.Count -gt 0) { @($ReadPath | ForEach-Object { Normalize-RelativePath ([string]$_) } | Select-Object -Unique) } else { @($allowed) }
    $readPaths = @($readPaths)
    foreach ($path in $readPaths) { if (@($routeScopes | Where-Object { Test-PathWithin $path $_ }).Count -eq 0) { throw "Read path '$path' is outside the approved context scope for $WorkPackage." } }
    if ($Role -ne 'REVIEWER') {
        foreach ($path in $allowed) { if (@($routeScopes | Where-Object { Test-PathWithin $path $_ }).Count -eq 0) { throw "Write path '$path' is outside the approved context scope for $WorkPackage." } }
    }
    if ($Role -eq 'REVIEWER' -and @($allowed | Where-Object { $_ -notmatch '^docs/05-quality/evidence/TASK-\d{3,}(?:/|$)' }).Count -gt 0) { throw "REVIEWER tasks may only write their own review evidence directory." }
    $routeDocuments = @($route.required_documents | ForEach-Object { [string]$_.doc_id }) + @($route.decisions | ForEach-Object { [string]$_ })
    $requestedDocuments = @($Document | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } | Select-Object -Unique)
    foreach ($docId in $requestedDocuments) { if ($docId -notin $routeDocuments) { throw "Document $docId is outside the current context route for $WorkPackage." } }
    $documents = @($routeDocuments | Where-Object { $_ } | Select-Object -Unique)
    $dependencies = @($Dependency | ForEach-Object { ([string]$_).Trim() } | Select-Object -Unique)
    if (@($dependencies | Where-Object { $_ -notmatch '^TASK-\d{3,}$' }).Count -gt 0) { throw 'Dependencies must use TASK-NNN identifiers.' }
    $repairTargets = @($RepairOf | ForEach-Object { ([string]$_).Trim() } | Select-Object -Unique)
    if (@($repairTargets | Where-Object { $_ -notmatch '^TASK-\d{3,}$' }).Count -gt 0) { throw 'RepairOf must use TASK-NNN identifiers.' }
    if (@($repairTargets | Where-Object { $_ -notin $dependencies }).Count -gt 0) { throw 'Every RepairOf task must also be declared as a dependency.' }
    if ($Role -eq 'REVIEWER' -and $repairTargets.Count -gt 0) { throw 'REVIEWER tasks cannot declare RepairOf.' }
    $validations = [System.Collections.Generic.List[object]]::new()
    $validationIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    if (-not [string]::IsNullOrWhiteSpace($ValidationCommand)) {
        $directArguments = @($ValidationArgument | ForEach-Object { [string]$_ })
        if (-not [string]::IsNullOrWhiteSpace($ValidationArgsBase64)) {
            try {
                $argumentJson = $script:GovernanceUtf8NoBom.GetString([Convert]::FromBase64String($ValidationArgsBase64))
                $decodedArguments = $argumentJson | ConvertFrom-Json -ErrorAction Stop
                if ($decodedArguments -isnot [System.Array]) { throw 'decoded value is not an array' }
                $directArguments = @($decodedArguments | ForEach-Object { [string]$_ })
            } catch { throw "ValidationArgsBase64 must encode a JSON string array: $($_.Exception.Message)" }
        }
        Assert-NoSecretValidationArguments $directArguments
        [void]$validationIds.Add($ValidationId)
        $validations.Add([ordered]@{ id=$ValidationId; command=$ValidationCommand.Trim(); args=$directArguments })
    }
    foreach ($json in $ValidationJson) {
        try { $validation = [string]$json | ConvertFrom-Json -ErrorAction Stop } catch { throw "Invalid ValidationJson: $json" }
        if ([string]$validation.id -notmatch '^[A-Za-z][A-Za-z0-9._-]{1,63}$' -or [string]::IsNullOrWhiteSpace([string]$validation.command) -or $validation.args -isnot [System.Array] -or -not $validationIds.Add([string]$validation.id)) { throw "ValidationJson must contain a unique id, command, and args array." }
        $jsonArguments = @($validation.args | ForEach-Object { [string]$_ })
        Assert-NoSecretValidationArguments $jsonArguments
        $validations.Add([ordered]@{ id=[string]$validation.id; command=[string]$validation.command; args=$jsonArguments })
    }
    $automaticRisks = [System.Collections.Generic.List[string]]::new()
    foreach ($path in $allowed) {
        if ($path -match '(?i)^docs/01-governance(?:/|$)') { $automaticRisks.Add('scope') }
        if ($path -match '(?i)^docs/02-product(?:/|$)') { $automaticRisks.Add('scope'); $automaticRisks.Add('success_criteria') }
        if ($path -match '(?i)^docs/03-architecture(?:/|$)') { $automaticRisks.Add('overall_architecture') }
        if ($path -match '(?i)^docs/04-delivery/WORK-PACKAGES\.md$') { $automaticRisks.Add('scope'); $automaticRisks.Add('success_criteria') }
        if ($path -match '(?i)(^|/)(api|public|contracts?)(/|$)') { $automaticRisks.Add('public_interface') }
        if ($path -match '(?i)(migration|migrations|schema|database|db)(/|$)') { $automaticRisks.Add('data_model_or_migration') }
        if ($path -match '(?i)(security|auth|permission|privacy|secrets?)(/|$)') { $automaticRisks.Add('security_privacy_compliance') }
        if ($path -match '(?i)(deploy|deployment|production|prod)(/|$)') { $automaticRisks.Add('production_release') }
    }
    $semanticRiskText = ((@($Title, $Goal) + @($validations | ForEach-Object { @([string]$_.command) + @($_.args | ForEach-Object { [string]$_ }) })) -join ' ')
    foreach ($semanticRisk in @(Get-GovernanceSemanticRiskFlags -Text $semanticRiskText)) { $automaticRisks.Add($semanticRisk) }
    $risks = @(@($RiskFlag) + @($automaticRisks) | Select-Object -Unique)
    $minimumProfile = Get-MinimumTaskProfile $null $risks
    if ((Get-ProfileRank $Profile) -lt (Get-ProfileRank $minimumProfile)) { throw "Task profile $Profile is too low for risk flags $($risks -join ', '); use at least $minimumProfile." }
    if ($Profile -eq 'Release') {
        foreach ($control in @($TargetEnvironment, $ExecutionWindow, $RollbackPlan, $ObservationMetrics, $StopConditions, $PostReleaseOwner)) {
            if ([string]::IsNullOrWhiteSpace([string]$control)) { throw 'Release tasks require target environment, execution window, rollback plan, observation metrics, stop conditions, and post-release owner.' }
        }
    }
    $releaseControls = if ($Profile -eq 'Release') {
        [ordered]@{ target_environment=$TargetEnvironment.Trim(); execution_window=$ExecutionWindow.Trim(); rollback_plan=$RollbackPlan.Trim(); observation_metrics=$ObservationMetrics.Trim(); stop_conditions=$StopConditions.Trim(); post_release_owner=$PostReleaseOwner.Trim() }
    } else { $null }
    $preexisting = @(Get-ChangedPaths | Where-Object { -not (Test-SystemPath $_ 'TASK-000' $WorkPackage) })
    Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
        Recover-PendingGovernanceTransaction
        if ([string]::IsNullOrWhiteSpace($TaskId)) {
            $numbers = @(Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'TASK-*.contract.json' -ErrorAction SilentlyContinue | Where-Object Name -match '^TASK-(\d+)\.contract\.json$' | ForEach-Object { [int]$Matches[1] })
            $next = if ($numbers.Count) { [int](($numbers | Measure-Object -Maximum).Maximum) + 1 } else { 1 }
            $TaskId = 'TASK-{0:D3}' -f $next
        }
        $paths = Get-TaskPaths $TaskId
        if (Test-Path -LiteralPath $paths.Contract -PathType Leaf) { throw "Governed task already exists: $TaskId" }
        if ($Role -eq 'REVIEWER' -and @($allowed | Where-Object { $_ -notmatch "^docs/05-quality/evidence/$([regex]::Escape($TaskId))(?:/|$)" }).Count -gt 0) { throw "REVIEWER tasks may only write their own review evidence directory: $TaskId" }
        foreach ($dependencyId in $dependencies) {
            if ($dependencyId -eq $TaskId) { throw "Task $TaskId cannot depend on itself." }
            [void](Read-TaskPair $dependencyId)
        }
        $now = (Get-Date).ToUniversalTime().ToString('o')
        $contract = [ordered]@{
            '$schema'='schemas/governed-work.schema.json'; schema_version=2; task_id=$TaskId; work_package=$WorkPackage
            title=$Title.Trim(); goal=$Goal.Trim(); baseline=$baseline; profile=$Profile; role=$Role; allowed_paths=$allowed; read_paths=$readPaths; write_paths=$allowed
            out_of_scope=@($OutOfScope); authoritative_documents=$documents; dependencies=$dependencies
            acceptance_criteria=@($AcceptanceCriterion); validations=$validations; risk_flags=$risks
            review=[ordered]@{ required=($Role -ne 'REVIEWER' -and [string]$governance.project.mode -eq 'TEAM_PROJECT') }
            created_at=$now
        }
        if ($repairTargets.Count -gt 0) { $contract['repair_of'] = $repairTargets }
        if ($null -ne $releaseControls) { $contract.release_controls = $releaseControls }
        $workStatusBeforePlan = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        $planLedgerPath = ''
        $planLedgerBefore = $null
        if ([string]$governance.project.mode -eq 'TEAM_PROJECT') {
            $planLedgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
            $planLedgerBefore = [System.IO.File]::ReadAllText($planLedgerPath, $script:GovernanceUtf8NoBom)
        }
        try {
            $planJournalFiles = [System.Collections.Generic.List[object]]::new()
            $planJournalFiles.Add([ordered]@{ path=[System.IO.Path]::GetFullPath($paths.Contract); existed=$false; content_base64='' })
            $planJournalFiles.Add([ordered]@{ path=[System.IO.Path]::GetFullPath($paths.State); existed=$false; content_base64='' })
            $planJournalFiles.Add([ordered]@{ path=[System.IO.Path]::GetFullPath($workStatusPath); existed=$true; content_base64=[Convert]::ToBase64String($script:GovernanceUtf8NoBom.GetBytes($workStatusBeforePlan)) })
            if ($planLedgerPath) { $planJournalFiles.Add([ordered]@{ path=$planLedgerPath; existed=$true; content_base64=[Convert]::ToBase64String($script:GovernanceUtf8NoBom.GetBytes($planLedgerBefore)) }) }
            $planJournal = [ordered]@{
                schema_version=1; project_root=$root; status='pending'; created_at=(Get-Date).ToUniversalTime().ToString('o')
                files=@($planJournalFiles)
            }
            Write-GovernanceJson -Path $transactionJournalPath -Value $planJournal
            Write-GovernanceJson -Path $paths.Contract -Value $contract
            $hash = (Get-FileHash -LiteralPath $paths.Contract -Algorithm SHA256).Hash.ToLowerInvariant()
            $state = [ordered]@{
                '$schema'='schemas/governed-work-state.schema.json'; schema_version=2; task_id=$TaskId; work_package=$WorkPackage
                contract_sha256=$hash; baseline=$baseline; state='planned'; approval_id=''; acceptance_subject_sha256=''; acceptance_evidence_sha256=''; acceptance_git_commit=''; start_git_commit=''; execution_lease=''; execution_lease_owner=''; execution_lease_expires_at=''
                preexisting_changes=$preexisting; plan_checkpoint_git_commit=(Get-GitCommit); plan_rebase_history=@(); evidence=@(); evidence_history=@(); review_history=@(); review=[ordered]@{ required=($Role -ne 'REVIEWER' -and [string]$governance.project.mode -eq 'TEAM_PROJECT'); reviewer_task_id=$(if ($ReviewerTaskId) { $ReviewerTaskId } else { '' }); status=$(if ($Role -eq 'REVIEWER' -or [string]$governance.project.mode -ne 'TEAM_PROJECT') { 'not-applicable' } elseif ($ReviewerTaskId) { 'pending' } else { 'unassigned' }); evidence=@(); pass_streak=0; subject_sha256='' }; last_error=''; created_at=$now; updated_at=$now
            }
            Write-GovernanceJson -Path $paths.State -Value $state
            Register-TeamLedgerTask -Contract $contract -InitialReviewerTaskId $ReviewerTaskId
            Sync-WorkPackageStatus -Id $WorkPackage
            Remove-Item -LiteralPath $transactionJournalPath -Force
        } catch {
            foreach ($createdPath in @($paths.State, $paths.Contract)) { if (Test-Path -LiteralPath $createdPath -PathType Leaf) { Remove-Item -LiteralPath $createdPath -Force } }
            if ($null -ne $planLedgerBefore) { Write-AtomicUtf8Text -Path $planLedgerPath -Content $planLedgerBefore }
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusBeforePlan
            if (Test-Path -LiteralPath $transactionJournalPath -PathType Leaf) { Remove-Item -LiteralPath $transactionJournalPath -Force }
            throw
        }
        Write-Output $paths.Contract
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($TaskId)) { throw "$Action requires TaskId." }
Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
    Recover-PendingGovernanceTransaction
    $pair = Read-TaskPair $TaskId
    if ($Action -eq 'Status') { Write-Output ($pair.State | ConvertTo-Json -Depth 20); return }
    Start-GovernanceActionTransaction
    try {

    if ($Action -eq 'RebasePlan') {
        if ([string]$pair.State.state -ne 'planned') { throw "Task $TaskId can only rebase its planning checkpoint while planned." }
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$governance.current_baseline -ne [string]$pair.Contract.baseline) { throw "Task $TaskId cannot rebase because the current baseline changed." }
        $nonGovernanceChanges = @(Get-ChangedPaths | Where-Object { -not (Test-SystemPath $_ $TaskId ([string]$pair.Contract.work_package)) })
        if ($nonGovernanceChanges.Count -gt 0) { throw "Task $TaskId cannot rebase while non-governance changes are present: $($nonGovernanceChanges -join ', ')." }
        $checkpoint = Get-GitCommit
        if ($checkpoint -notmatch '^[0-9a-fA-F]{7,64}$') { throw "Task $TaskId cannot rebase without a valid Git checkpoint." }
        $stateSnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        try {
            $history = @((Get-Property $pair.State 'plan_rebase_history') | Where-Object { $null -ne $_ })
            $history += [pscustomobject][ordered]@{ previous_changes=@($pair.State.preexisting_changes); checkpoint_git_commit=$checkpoint; rebased_at=(Get-Date).ToUniversalTime().ToString('o') }
            $pair.State.preexisting_changes = @()
            Set-ObjectProperty -Object $pair.State -Name 'plan_checkpoint_git_commit' -Value $checkpoint
            Set-ObjectProperty -Object $pair.State -Name 'plan_rebase_history' -Value @($history)
            $pair.State.last_error = ''
            Write-State $pair
            Invoke-StrictValidation
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $stateSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'MigrateTask') {
        if ([string]$pair.State.state -eq 'accepted') { throw "Accepted delivery tasks must use ReopenAcceptance; accepted reviewer tasks must use MigrateReviewer." }
        $governance = Read-GovernanceJson -Path $governancePath
        $stateSnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        $ledgerPath = ''
        $ledgerSnapshot = $null
        if ([string]$governance.project.mode -eq 'TEAM_PROJECT') {
            $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
            $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
        }
        try {
            $pair.State.schema_version = 2
            foreach ($propertyName in @('acceptance_subject_sha256', 'acceptance_evidence_sha256', 'acceptance_git_commit', 'execution_lease_owner', 'execution_lease_expires_at')) {
                if ($null -eq $pair.State.PSObject.Properties[$propertyName]) { Set-ObjectProperty -Object $pair.State -Name $propertyName -Value '' }
            }
            $reviewHistoryWasMissing = $null -eq $pair.State.PSObject.Properties['review_history']
            foreach ($arrayName in @('evidence_history', 'review_history')) {
                if ($null -eq $pair.State.PSObject.Properties[$arrayName]) { Set-ObjectProperty -Object $pair.State -Name $arrayName -Value @() }
            }
            if ($reviewHistoryWasMissing) {
                $migratedReviewHistory = [System.Collections.Generic.List[object]]::new()
                $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
                foreach ($evidencePath in @($pair.State.evidence_history | ForEach-Object { [string]$_ } | Where-Object { $_ })) {
                    $resolvedEvidencePath = [System.IO.Path]::GetFullPath((Join-Path $root $evidencePath))
                    if (-not $resolvedEvidencePath.StartsWith($rootPrefix, $script:GovernancePathComparison) -or -not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) { continue }
                    try { $legacyEvidence = [System.IO.File]::ReadAllText($resolvedEvidencePath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop } catch { continue }
                    if ([string](Get-Property $legacyEvidence '$schema') -ne 'schemas/review-evidence.schema.json' -or [string](Get-Property $legacyEvidence 'result') -notin @('passed', 'changes-required', 'cancelled')) { continue }
                    $migratedReviewHistory.Add([pscustomobject][ordered]@{ path=$evidencePath; sha256=(Get-FileHash -LiteralPath $resolvedEvidencePath -Algorithm SHA256).Hash.ToLowerInvariant(); result=[string]$legacyEvidence.result; recorded_at=(Get-Date).ToUniversalTime().ToString('o') })
                }
                $pair.State.review_history = @($migratedReviewHistory)
            }
            if ([string]$pair.State.state -eq 'in-progress' -and ([string]::IsNullOrWhiteSpace([string]$pair.State.execution_lease_owner) -or [string]::IsNullOrWhiteSpace([string]$pair.State.execution_lease_expires_at))) {
                $pair.State.state = 'needs-decision'; Clear-ExecutionLease $pair; $pair.State.last_error = 'Legacy active task had no attributable expiring lease and requires an explicit replacement decision.'
            } elseif ([string]$pair.State.state -ne 'in-progress') { Clear-ExecutionLease $pair }
            $role = [string](Get-Property $pair.Contract 'role')
            $isTeam = [string]$governance.project.mode -eq 'TEAM_PROJECT'
            $review = Get-Property $pair.State 'review'
            if ($null -eq $review) {
                $review = [pscustomobject][ordered]@{ required=($isTeam -and $role -ne 'REVIEWER'); reviewer_task_id=''; status=$(if ($isTeam -and $role -ne 'REVIEWER') { 'unassigned' } else { 'not-applicable' }); evidence=@(); pass_streak=0; subject_sha256='' }
                Set-ObjectProperty -Object $pair.State -Name 'review' -Value $review
            }
            $hadPassStreak = $null -ne $review.PSObject.Properties['pass_streak']
            if ($null -eq $review.PSObject.Properties['required']) { Set-ObjectProperty -Object $review -Name 'required' -Value ($isTeam -and $role -ne 'REVIEWER') }
            if ($null -eq $review.PSObject.Properties['reviewer_task_id']) { Set-ObjectProperty -Object $review -Name 'reviewer_task_id' -Value '' }
            if ($null -eq $review.PSObject.Properties['status']) { Set-ObjectProperty -Object $review -Name 'status' -Value $(if ($isTeam -and $role -ne 'REVIEWER') { 'unassigned' } else { 'not-applicable' }) }
            if ($null -eq $review.PSObject.Properties['evidence']) { Set-ObjectProperty -Object $review -Name 'evidence' -Value @() }
            if ($null -eq $review.PSObject.Properties['pass_streak']) { Set-ObjectProperty -Object $review -Name 'pass_streak' -Value 0 }
            if ($null -eq $review.PSObject.Properties['subject_sha256']) { Set-ObjectProperty -Object $review -Name 'subject_sha256' -Value '' }
            if ($role -eq 'REVIEWER' -or -not $isTeam) {
                $review.required = $false; $review.reviewer_task_id = ''; $review.status = 'not-applicable'; $review.evidence = @(); $review.pass_streak = 0; $review.subject_sha256 = ''
            } else {
                $review.required = $true
                if ([string]$review.reviewer_task_id -notmatch '^TASK-\d{3,}$') {
                    $legacyReviewerId = [string](Get-Property (Get-Property $pair.Contract 'review') 'reviewer_task_id')
                    $review.reviewer_task_id = if ($legacyReviewerId -match '^TASK-\d{3,}$') { $legacyReviewerId } else { '' }
                }
                if ([string]$review.status -notin @('unassigned', 'pending', 'running', 'changes-required', 'provisional-passed', 'passed', 'cancelled')) { $review.status = if ($review.reviewer_task_id) { 'pending' } else { 'unassigned' } }
                if (-not $hadPassStreak -and [string]$review.status -in @('provisional-passed', 'passed')) { $review.status = 'changes-required'; $review.evidence = @(); $review.pass_streak = 0; $review.subject_sha256 = '' }
            }
            Write-State $pair
            if ($role -eq 'REVIEWER' -and [string]$pair.State.state -eq 'verified') { Update-TeamLedgerTaskState -TaskId $TaskId -RuntimeState 'verified' -LedgerState 'completed' }
            Invoke-StrictValidation -AllowLegacyTaskStates
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $stateSnapshot
            if ($null -ne $ledgerSnapshot) { Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot }
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'AssignReview') {
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { throw 'AssignReview is only available in TEAM_PROJECT.' }
        if ([string](Get-Property $pair.Contract 'role') -eq 'REVIEWER') { throw "Reviewer task $TaskId cannot receive another reviewer." }
        $legacyReviewMigration = [int](Get-Property $pair.Contract 'schema_version') -lt 2 -and [string]$pair.State.state -in @('verified', 'accepted')
        if ([string]$pair.State.state -ne 'planned' -and -not $legacyReviewMigration) { throw "Review assignment must happen while $TaskId is planned, except during explicit v1 review migration." }
        if ([string]::IsNullOrWhiteSpace($ReviewerTaskId) -or $ReviewerTaskId -eq $TaskId) { throw "AssignReview requires a different ReviewerTaskId." }
        $reviewerPair = Read-TaskPair $ReviewerTaskId
        if ([string](Get-Property $reviewerPair.Contract 'role') -ne 'REVIEWER') { throw "Reviewer task $ReviewerTaskId must be planned with role REVIEWER." }
        if ([string]$reviewerPair.Contract.work_package -ne [string]$pair.Contract.work_package) { throw 'Reviewer task must belong to the same work package.' }
        if (@($reviewerPair.Contract.dependencies | Where-Object { [string]$_ -eq $TaskId }).Count -eq 0) { throw "Reviewer task $ReviewerTaskId must depend on $TaskId." }
        if ($null -eq $pair.State.review) { Set-ObjectProperty -Object $pair.State -Name 'review' -Value ([pscustomobject][ordered]@{ required=$true; reviewer_task_id=''; status='unassigned'; evidence=@(); pass_streak=0; subject_sha256='' }) }
        $pair.State.review.required = $true
        $pair.State.review.reviewer_task_id = $ReviewerTaskId
        $pair.State.review.status = 'pending'
        $pair.State.review.evidence = @()
        Set-ObjectProperty -Object $pair.State.review -Name 'pass_streak' -Value 0
        Set-ObjectProperty -Object $pair.State.review -Name 'subject_sha256' -Value ''
        Write-State $pair
        Update-TeamLedgerReview -TaskId $TaskId -Status 'pending' -Evidence 'pending' -ReviewerTaskId $ReviewerTaskId
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'MigrateReviewer') {
        if ([string](Get-Property $pair.Contract 'role') -ne 'REVIEWER' -or [string]$pair.State.state -ne 'accepted') { throw "MigrateReviewer only normalizes a legacy REVIEWER task from accepted to verified." }
        $stateSnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        $governance = Read-GovernanceJson -Path $governancePath
        $ledgerRelative = [string]$governance.authoritative_documents.task_ledger
        $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root $ledgerRelative))
        $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
        $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        try {
            Upgrade-TaskStateSchemaV2 $pair $governance
            $pair.State.state = 'verified'
            $pair.State.approval_id = ''
            $pair.State.last_error = ''
            Write-State $pair
            Update-TeamLedgerTaskState -TaskId $TaskId -RuntimeState 'verified' -LedgerState 'completed'
            Sync-WorkPackageStatus -Id ([string]$pair.Contract.work_package)
            Invoke-StrictValidation -AllowLegacyTaskStates
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $stateSnapshot
            Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'MigrateCompletedReviewerBaseline') {
        if ([string](Get-Property $pair.Contract 'role') -ne 'REVIEWER' -or [string]$pair.State.state -ne 'needs-decision') { throw "MigrateCompletedReviewerBaseline only restores a REVIEWER task stopped at needs-decision." }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'MigrateCompletedReviewerBaseline requires Reason.' }
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$pair.Contract.baseline -eq [string]$governance.current_baseline) { throw "Reviewer task $TaskId is already on the current baseline and is not eligible for historical migration." }
        $acceptedDeliveries = [System.Collections.Generic.List[string]]::new()
        foreach ($candidateStatePath in @(Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'TASK-*.state.json' -ErrorAction SilentlyContinue)) {
            try { $candidateState = [System.IO.File]::ReadAllText($candidateStatePath.FullName, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop } catch { continue }
            $candidateReview = Get-Property $candidateState 'review'
            if ([string](Get-Property $candidateState 'state') -eq 'accepted' -and [string](Get-Property $candidateReview 'reviewer_task_id') -eq $TaskId -and [string](Get-Property $candidateReview 'status') -eq 'passed') {
                $acceptedDeliveries.Add([string](Get-Property $candidateState 'task_id'))
            }
        }
        if ($acceptedDeliveries.Count -eq 0) { throw "Reviewer task $TaskId is not bound to an accepted delivery with a final passed review." }
        $passedHistory = @((Get-Property $pair.State 'review_history') | Where-Object { [string](Get-Property $_ 'result') -eq 'passed' })
        if ($passedHistory.Count -eq 0) { throw "Reviewer task $TaskId has no immutable passed review history." }
        foreach ($historyEntry in $passedHistory) {
            $historyPath = [string](Get-Property $historyEntry 'path')
            $resolvedHistoryPath = [System.IO.Path]::GetFullPath((Join-Path $root $historyPath))
            $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
            if (-not $resolvedHistoryPath.StartsWith($rootPrefix, $script:GovernancePathComparison) -or -not (Test-Path -LiteralPath $resolvedHistoryPath -PathType Leaf)) { throw "Reviewer task $TaskId has missing or out-of-project passed evidence: $historyPath" }
            $currentHistoryHash = (Get-FileHash -LiteralPath $resolvedHistoryPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ([string](Get-Property $historyEntry 'sha256') -ne $currentHistoryHash) { throw "Reviewer task $TaskId passed evidence has changed: $historyPath" }
        }
        $stateSnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        $ledgerRelative = [string]$governance.authoritative_documents.task_ledger
        $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root $ledgerRelative))
        $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
        $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        try {
            $pair.State.state = 'verified'
            $pair.State.approval_id = ''
            Clear-ExecutionLease $pair
            $pair.State.last_error = "Completed reviewer baseline migration confirmed for $($acceptedDeliveries -join ', '): $($Reason.Trim())"
            Write-State $pair
            Update-TeamLedgerTaskState -TaskId $TaskId -RuntimeState 'verified' -LedgerState 'completed'
            Sync-WorkPackageStatus -Id ([string]$pair.Contract.work_package)
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $stateSnapshot
            Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'ReopenReview') {
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$governance.project.mode -ne 'TEAM_PROJECT') { throw 'ReopenReview is only available in TEAM_PROJECT.' }
        if ([string](Get-Property $pair.Contract 'role') -eq 'REVIEWER') { throw 'ReopenReview must target the reviewed delivery task, not the reviewer task.' }
        if ([string]$pair.State.state -ne 'verified') { throw "Task $TaskId must be verified before reopening independent review." }
        $review = Get-Property $pair.State 'review'
        $reviewerId = [string](Get-Property $review 'reviewer_task_id')
        $reviewStatus = [string](Get-Property $review 'status')
        if ($reviewerId -notmatch '^TASK-\d{3,}$') { throw "Task $TaskId does not have a valid reviewer task to reopen." }
        $reviewerPair = Read-TaskPair $reviewerId
        $deliveryProfile = [string](Get-Property $pair.Contract 'profile')
        $legacySinglePass = $deliveryProfile -in @('Standard', 'Release') -and $reviewStatus -eq 'passed' -and [int](Get-Property $review 'pass_streak') -lt 2
        if ($reviewStatus -notin @('changes-required', 'provisional-passed') -and -not $legacySinglePass) { throw "Task $TaskId does not have a changes-required, first-pass, or legacy single-pass review to reopen." }
        if ($reviewStatus -eq 'provisional-passed' -and [int](Get-Property $review 'pass_streak') -ne 1) { throw "Task $TaskId first-pass review state is inconsistent." }
        $reviewerDependencies = @((Get-Property $reviewerPair.Contract 'dependencies') | ForEach-Object { [string]$_ })
        $reviewerState = [string]$reviewerPair.State.state
        if ([string](Get-Property $reviewerPair.Contract 'role') -ne 'REVIEWER' -or [string]$reviewerPair.Contract.work_package -ne [string]$pair.Contract.work_package -or $reviewerDependencies -notcontains $TaskId -or $reviewerState -notin @('verified', 'planned')) { throw "Reviewer task $reviewerId is not eligible to reopen." }
        $deliverySnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        $reviewerSnapshot = [System.IO.File]::ReadAllText($reviewerPair.Paths.State, $script:GovernanceUtf8NoBom)
        $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
        $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
        $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        try {
            if ($reviewerState -eq 'verified') {
                $reviewerPair.State.state = 'planned'
                $reviewerPair.State.evidence = @()
                Clear-ExecutionLease $reviewerPair
                $reviewerPair.State.last_error = ''
                Write-State $reviewerPair
            }
            $pair.State.review.status = 'pending'
            $pair.State.review.evidence = @()
            if ($legacySinglePass) {
                Set-ObjectProperty -Object $pair.State.review -Name 'pass_streak' -Value 0
                Set-ObjectProperty -Object $pair.State.review -Name 'subject_sha256' -Value ''
            }
            Write-State $pair
            Update-TeamLedgerReview -TaskId $TaskId -Status 'pending' -Evidence ''
            Sync-WorkPackageStatus -Id ([string]$pair.Contract.work_package)
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $deliverySnapshot
            Write-AtomicUtf8Text -Path $reviewerPair.Paths.State -Content $reviewerSnapshot
            Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
            throw
        }
        Write-Output $reviewerPair.Paths.State
        return
    }

    if ($Action -eq 'RecordReview') {
        if ([string](Get-Property $pair.Contract 'role') -ne 'REVIEWER') { throw "Only a REVIEWER task can record a review." }
        Assert-ReviewerWriteScope $pair.Contract $TaskId
        if ([string]$pair.State.state -ne 'verified') { throw "Reviewer task $TaskId must be verified before recording a review." }
        if ([string]::IsNullOrWhiteSpace($ReviewResult) -or $ReviewEvidence.Count -eq 0) { throw 'RecordReview requires ReviewResult and ReviewEvidence.' }
        $reviewRecords = @($ReviewEvidence | ForEach-Object { Read-ReviewEvidence ([string]$_) $TaskId $ReviewResult })
        $reviewedTaskIds = @($reviewRecords | ForEach-Object { @($_.Value.reviewed_task_ids) } | Select-Object -Unique)
        if ($reviewedTaskIds.Count -eq 0) { throw 'Review evidence must identify at least one reviewed task.' }
        $reviewHistory = [System.Collections.Generic.List[object]]::new()
        foreach ($historyEntry in @($pair.State.review_history)) { if ($null -ne $historyEntry) { $reviewHistory.Add($historyEntry) } }
        $reviewRoundId = 'RR-' + [guid]::NewGuid().ToString('N')
        foreach ($reviewRecord in $reviewRecords) {
            $reviewHash = (Get-FileHash -LiteralPath ([System.IO.Path]::GetFullPath((Join-Path $root $reviewRecord.Path))) -Algorithm SHA256).Hash.ToLowerInvariant()
            $existingHistory = @($reviewHistory | Where-Object { [string]$_.path -eq [string]$reviewRecord.Path })
            if ($existingHistory.Count -gt 0) {
                if ([string]$existingHistory[0].sha256 -ne $reviewHash) { throw "Historical review evidence is immutable and has changed: $($reviewRecord.Path)" }
                throw "Each review round requires a new evidence file: $($reviewRecord.Path)"
            }
            if (@($reviewHistory | Where-Object { [string]$_.sha256 -eq $reviewHash }).Count -gt 0) { throw "Each review round requires new evidence content, not a copied historical evidence file: $($reviewRecord.Path)" }
            $reviewHistory.Add([pscustomobject][ordered]@{ path=[string]$reviewRecord.Path; sha256=$reviewHash; result=$ReviewResult; round_id=$reviewRoundId; recorded_at=(Get-Date).ToUniversalTime().ToString('o') })
        }
        $reviewPlans = [System.Collections.Generic.List[object]]::new()
        foreach ($reviewedTaskId in $reviewedTaskIds) {
            if ([string]$reviewedTaskId -eq $TaskId) { throw 'A reviewer task cannot review itself.' }
            $reviewedPair = Read-TaskPair ([string]$reviewedTaskId)
            if ([string](Get-Property $reviewedPair.Contract 'role') -eq 'REVIEWER') { throw "A REVIEWER task cannot be reviewed as a delivery task: $reviewedTaskId" }
            if ([string]$reviewedPair.Contract.work_package -ne [string]$pair.Contract.work_package) { throw "Reviewed task $reviewedTaskId must belong to the same work package." }
            if ($ReviewResult -ne 'cancelled' -and [string]$reviewedPair.State.state -ne 'verified') { throw "Reviewed task $reviewedTaskId must be verified and not yet accepted before independent review." }
            $currentReviewStatus = [string](Get-Property (Get-Property $reviewedPair.State 'review') 'status')
            if ($ReviewResult -ne 'cancelled' -and $currentReviewStatus -ne 'pending') { throw "Reviewed task $reviewedTaskId must be reopened to pending before recording another review round." }
            $taskReviewRecords = @($reviewRecords | Where-Object { [string]$reviewedTaskId -in @($_.Value.reviewed_task_ids) })
            if ($taskReviewRecords.Count -eq 0) { throw "Review evidence does not contain a record for reviewed task $reviewedTaskId." }
            foreach ($reviewRecord in $taskReviewRecords) { Assert-ReviewChangeManifest $reviewRecord.Value ([string]$reviewedTaskId) $reviewedPair $ReviewResult }
            $taskReviewEvidencePaths = @($taskReviewRecords | ForEach-Object { [string]$_.Path } | Select-Object -Unique)
            if ($ReviewResult -eq 'cancelled' -and [string]$reviewedPair.State.state -ne 'superseded') { throw "Review can only be cancelled for a superseded task: $reviewedTaskId" }
            $subjectSha256 = if ($ReviewResult -eq 'cancelled') { '' } else { Get-ReviewSubjectSha256 $reviewedPair ([string]$reviewedTaskId) }
            $reviewPlans.Add([pscustomobject]@{ TaskId=[string]$reviewedTaskId; Pair=$reviewedPair; EvidencePaths=$taskReviewEvidencePaths; SubjectSha256=$subjectSha256 })
        }
        $ledgerRows = @(Get-TeamLedgerRows)
        foreach ($requiredTaskId in @($TaskId) + @($reviewPlans | ForEach-Object TaskId)) {
            if (@($ledgerRows | Where-Object TaskId -eq $requiredTaskId).Count -ne 1) { throw "TEAM_PROJECT task ledger must contain exactly one row for $requiredTaskId before recording a review." }
        }
        $stateSnapshots = @{}
        foreach ($plan in @($reviewPlans)) { $stateSnapshots[$plan.TaskId] = [System.IO.File]::ReadAllText($plan.Pair.Paths.State, $script:GovernanceUtf8NoBom) }
        $stateSnapshots[$TaskId] = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        $ledgerRelative = [string](Read-GovernanceJson -Path $governancePath).authoritative_documents.task_ledger
        $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root $ledgerRelative))
        $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
        $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        try {
            foreach ($plan in @($reviewPlans)) {
                $reviewedTaskId = [string]$plan.TaskId
                $reviewedPair = $plan.Pair
                if ($null -eq $reviewedPair.State.review) { $reviewedPair.State.review = [ordered]@{ required=$true; reviewer_task_id=''; status='unassigned'; evidence=@(); pass_streak=0; subject_sha256='' } }
                $reviewedPair.State.review.required = $true
                $reviewedPair.State.review.reviewer_task_id = $TaskId
                $effectiveReviewStatus = $ReviewResult
                $nextPassStreak = 0
                $nextSubjectSha256 = ''
                if ($ReviewResult -eq 'passed') {
                    $previousPassStreak = [int](Get-Property $reviewedPair.State.review 'pass_streak')
                    $previousSubjectSha256 = [string](Get-Property $reviewedPair.State.review 'subject_sha256')
                    $requiredRounds = Get-RequiredReviewRounds $reviewedPair.Contract
                    $nextPassStreak = if ($previousPassStreak -ge 1 -and $previousSubjectSha256 -eq [string]$plan.SubjectSha256) { [Math]::Min($requiredRounds, $previousPassStreak + 1) } else { 1 }
                    $nextSubjectSha256 = [string]$plan.SubjectSha256
                    $effectiveReviewStatus = if ($nextPassStreak -ge $requiredRounds) { 'passed' } else { 'provisional-passed' }
                }
                $reviewedPair.State.review.status = $effectiveReviewStatus
                $reviewedPair.State.review.evidence = @($plan.EvidencePaths)
                Set-ObjectProperty -Object $reviewedPair.State.review -Name 'pass_streak' -Value $nextPassStreak
                Set-ObjectProperty -Object $reviewedPair.State.review -Name 'subject_sha256' -Value $nextSubjectSha256
                if ($ReviewResult -eq 'changes-required') { $reviewedPair.State.state = 'implemented'; $reviewedPair.State.last_error = 'Independent review requires changes; consecutive pass count reset.' }
                Write-State $reviewedPair
                Update-TeamLedgerReview -TaskId $reviewedTaskId -Status $effectiveReviewStatus -Evidence ($plan.EvidencePaths -join ', ')
            }
            $history = @($pair.State.evidence_history) + @($reviewRecords | ForEach-Object Path) | Select-Object -Unique
            $pair.State.evidence_history = @($history)
            $pair.State.review_history = @($reviewHistory)
            Write-State $pair
            Update-TeamLedgerTaskState -TaskId $TaskId -RuntimeState ([string]$pair.State.state) -LedgerState 'completed'
            Invoke-StrictValidation
        } catch {
            foreach ($snapshotTaskId in $stateSnapshots.Keys) { $snapshotPair = if ($snapshotTaskId -eq $TaskId) { $pair } else { @($reviewPlans | Where-Object TaskId -eq $snapshotTaskId)[0].Pair }; Write-AtomicUtf8Text -Path $snapshotPair.Paths.State -Content $stateSnapshots[$snapshotTaskId] }
            Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'ReopenAcceptance') {
        if ([string](Get-Property $pair.Contract 'role') -eq 'REVIEWER' -or [string]$pair.State.state -ne 'accepted') { throw "ReopenAcceptance only reopens an accepted delivery task." }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'ReopenAcceptance requires Reason.' }
        $governance = Read-GovernanceJson -Path $governancePath
        $isTeam = [string]$governance.project.mode -eq 'TEAM_PROJECT'
        $deliverySnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        Upgrade-TaskStateSchemaV2 $pair $governance
        $reviewerPair = $null
        $reviewerSnapshot = $null
        if ($isTeam) {
            $reviewerId = [string](Get-Property (Get-Property $pair.State 'review') 'reviewer_task_id')
            if ($reviewerId -notmatch '^TASK-\d{3,}$') { throw "Accepted TEAM_PROJECT task $TaskId has no reviewer to re-run." }
            $reviewerPair = Read-TaskPair $reviewerId
            $reviewerSnapshot = [System.IO.File]::ReadAllText($reviewerPair.Paths.State, $script:GovernanceUtf8NoBom)
            Upgrade-TaskStateSchemaV2 $reviewerPair $governance
            $legacyReviewerWasPlanned = [int](Get-Property $pair.Contract 'schema_version') -lt 2 -and [string]$reviewerPair.State.state -eq 'planned'
            if ([string](Get-Property $reviewerPair.Contract 'role') -ne 'REVIEWER' -or [string]$reviewerPair.Contract.work_package -ne [string]$pair.Contract.work_package -or ([string]$reviewerPair.State.state -notin @('verified', 'accepted') -and -not $legacyReviewerWasPlanned)) { throw "Reviewer task $reviewerId cannot be normalized for a new acceptance cycle." }
        }
        $ledgerPath = ''
        $ledgerSnapshot = $null
        if ($isTeam) {
            $ledgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$governance.authoritative_documents.task_ledger)))
            $ledgerSnapshot = [System.IO.File]::ReadAllText($ledgerPath, $script:GovernanceUtf8NoBom)
        }
        $workStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        try {
            $pair.State.state = 'verified'
            $pair.State.approval_id = ''
            Set-ObjectProperty -Object $pair.State -Name 'acceptance_subject_sha256' -Value ''
            Set-ObjectProperty -Object $pair.State -Name 'acceptance_evidence_sha256' -Value ''
            Set-ObjectProperty -Object $pair.State -Name 'acceptance_git_commit' -Value ''
            Clear-ExecutionLease $pair
            $pair.State.last_error = "Acceptance reopened: $($Reason.Trim())"
            if ($isTeam) {
                $pair.State.review.status = if ($legacyReviewerWasPlanned) { 'pending' } else { 'changes-required' }
                $pair.State.review.evidence = @()
                Set-ObjectProperty -Object $pair.State.review -Name 'pass_streak' -Value 0
                Set-ObjectProperty -Object $pair.State.review -Name 'subject_sha256' -Value ''
                if (-not $legacyReviewerWasPlanned) { $reviewerPair.State.state = 'verified' }
                $reviewerPair.State.approval_id = ''
                Set-ObjectProperty -Object $reviewerPair.State -Name 'acceptance_subject_sha256' -Value ''
                Set-ObjectProperty -Object $reviewerPair.State -Name 'acceptance_evidence_sha256' -Value ''
                Set-ObjectProperty -Object $reviewerPair.State -Name 'acceptance_git_commit' -Value ''
                if ($null -eq $reviewerPair.State.review) { $reviewerPair.State.review = [ordered]@{ required=$false; reviewer_task_id=''; status='not-applicable'; evidence=@(); pass_streak=0; subject_sha256='' } }
                Set-ObjectProperty -Object $reviewerPair.State.review -Name 'pass_streak' -Value 0
                Set-ObjectProperty -Object $reviewerPair.State.review -Name 'subject_sha256' -Value ''
                Clear-ExecutionLease $reviewerPair
                Write-State $reviewerPair
            } elseif ($null -ne $pair.State.review) {
                Set-ObjectProperty -Object $pair.State.review -Name 'pass_streak' -Value 0
                Set-ObjectProperty -Object $pair.State.review -Name 'subject_sha256' -Value ''
            }
            Write-State $pair
            if ($isTeam) { Update-TeamLedgerReview -TaskId $TaskId -Status 'changes-required' -Evidence '' }
            if ($isTeam -and $legacyReviewerWasPlanned) { Update-TeamLedgerReview -TaskId $TaskId -Status 'pending' -Evidence 'pending' }
            Sync-WorkPackageStatus -Id ([string]$pair.Contract.work_package)
            Invoke-StrictValidation -AllowLegacyTaskStates
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $deliverySnapshot
            if ($null -ne $reviewerSnapshot) { Write-AtomicUtf8Text -Path $reviewerPair.Paths.State -Content $reviewerSnapshot }
            if ($null -ne $ledgerSnapshot) { Write-AtomicUtf8Text -Path $ledgerPath -Content $ledgerSnapshot }
            Write-AtomicUtf8Text -Path $workStatusPath -Content $workStatusSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'RecordApproval') {
        if ([string]::IsNullOrWhiteSpace($ApprovalType) -or [string]::IsNullOrWhiteSpace($ApprovalText) -or [string]::IsNullOrWhiteSpace($Approver) -or [string]::IsNullOrWhiteSpace($ConfirmationId)) { throw 'RecordApproval requires ApprovalType, ApprovalText, Approver, and ConfirmationId from the explicit user instruction.' }
        if ($ApprovalType -eq 'execution' -and ([string]$pair.State.state -ne 'planned' -or (@($pair.Contract.risk_flags).Count -eq 0 -and [string]$pair.Contract.profile -ne 'Release'))) { throw "Execution approval is only valid for a planned risk-bearing or Release task." }
        if ($ApprovalType -eq 'acceptance' -and [string](Get-Property $pair.Contract 'role') -eq 'REVIEWER') { throw "REVIEWER tasks use RecordReview and cannot receive an acceptance approval." }
        if ($ApprovalType -eq 'acceptance' -and [string]$pair.State.state -ne 'verified') { throw "Acceptance approval is only valid for a verified task." }
        $acceptanceSnapshot = $null
        if ($ApprovalType -eq 'acceptance') {
            Assert-TeamReviewPassed $TaskId
            $acceptanceSnapshot = Get-AcceptanceSnapshot $pair $TaskId
        }
        $log = [System.IO.File]::ReadAllText($approvalLogPath, $script:GovernanceUtf8NoBom)
        if ($log -match "(?m)^\s*confirmation_id:\s*$([regex]::Escape($ConfirmationId))\s*$") { throw "ConfirmationId $ConfirmationId has already been used for another approval." }
        $numbers = @([regex]::Matches($log, '(?m)^\s*approval_id:\s*APR-(\d+)\s*$') | ForEach-Object { [int]$_.Groups[1].Value })
        $next = if ($numbers.Count) { [int](($numbers | Measure-Object -Maximum).Maximum) + 1 } else { 1 }
        $newApprovalId = 'APR-{0:D3}' -f $next
        $safeApprover = $Approver.Trim().Replace("`r", ' ').Replace("`n", ' ')
        $safeText = $ApprovalText.Trim().Replace("`r", ' ').Replace("`n", ' ')
        $scopeLines = (@($pair.Contract.allowed_paths) | ForEach-Object { "  - $_" }) -join "`n"
        $record = @"

## $newApprovalId

approval_id: $newApprovalId
status: approved
approval_type: $ApprovalType
approved_items:
  - $TaskId
scope:
$scopeLines
plan_sha256: $($pair.Hash)
subject_sha256: $(if ($null -ne $acceptanceSnapshot) { $acceptanceSnapshot.SubjectSha256 } else { 'null' })
evidence_sha256: $(if ($null -ne $acceptanceSnapshot) { $acceptanceSnapshot.EvidenceSha256 } else { 'null' })
approver: $safeApprover
confirmation_id: $ConfirmationId
approved_at: $((Get-Date).ToUniversalTime().ToString('o'))
expires_at: null
baseline: $($pair.Contract.baseline)
related_change: null
related_work_packages:
  - $($pair.Contract.work_package)
approval_text: $safeText
evidence: current-user-instruction
notes: generated by Invoke-AIGovernedTask.ps1
"@
        Write-AtomicUtf8Text -Path $approvalLogPath -Content ($log.TrimEnd() + "`r`n" + $record.TrimStart())
        Write-Output $newApprovalId
        return
    }

    if ($Action -eq 'Recover') {
        if ([string]$pair.State.state -ne 'in-progress') { throw "Task $TaskId can only recover from in-progress." }
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'Recover requires Reason.' }
        $rawExpiry = Get-Property $pair.State 'execution_lease_expires_at'
        $expires = [DateTimeOffset]::MinValue
        $validExpiry = if ($rawExpiry -is [DateTime]) { $expires = [DateTimeOffset]::new(([DateTime]$rawExpiry).ToUniversalTime()); $true } else { [DateTimeOffset]::TryParse([string]$rawExpiry, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$expires) }
        if (-not $validExpiry -or $expires -gt [DateTimeOffset]::UtcNow) { throw "Task $TaskId execution lease is still active; wait for expiry or use NeedsDecision with explicit human direction." }
        $pair.State.state = 'needs-decision'; Clear-ExecutionLease $pair; $pair.State.last_error = $Reason.Trim(); Write-State $pair; Write-Output $pair.Paths.State; return
    }

    if ($Action -in @('Block', 'NeedsDecision', 'Supersede')) {
        if ([string]::IsNullOrWhiteSpace($Reason)) { throw "$Action requires Reason." }
        if ([string]$pair.State.state -in @('accepted', 'superseded')) { throw "Task $TaskId cannot transition from terminal state $($pair.State.state)." }
        if ($Action -eq 'Block' -and [string]$pair.State.state -notin @('planned', 'in-progress', 'implemented')) { throw "Task $TaskId cannot be blocked from state $($pair.State.state)." }
        $pair.State.state = switch ($Action) { 'Block' { 'blocked' } 'NeedsDecision' { 'needs-decision' } default { 'superseded' } }
        Clear-ExecutionLease $pair
        $pair.State.last_error = $Reason.Trim()
        Write-State $pair
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'Resume') {
        if ([string]$pair.State.state -ne 'blocked') { throw "Task $TaskId can only resume from blocked." }
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$governance.current_baseline -ne [string]$pair.Contract.baseline) { throw "Task $TaskId cannot resume because the current baseline changed." }
        foreach ($dependencyId in @($pair.Contract.dependencies)) {
            $dependencyPair = Read-TaskPair ([string]$dependencyId)
            if (-not (Test-TaskDependencyReady $pair ([string]$dependencyId) $dependencyPair)) { throw "Task dependency $dependencyId is neither verified nor an explicit changes-required repair target." }
        }
        if ([string]::IsNullOrWhiteSpace([string]$pair.State.start_git_commit)) {
            $pair.State.state = 'planned'
        } else {
            $outside = [System.Collections.Generic.List[string]]::new()
            foreach ($changed in @(Get-ChangedPaths -BaseCommit ([string]$pair.State.start_git_commit))) {
                if (Test-SystemPath $changed $TaskId ([string]$pair.Contract.work_package)) { continue }
            $matchingScopes = @(Get-TaskWritePaths $pair.Contract | Where-Object { Test-PathWithin $changed ([string]$_) })
                if ($matchingScopes.Count -eq 0) { $outside.Add($changed) }
            }
            if ($outside.Count -gt 0) { $pair.State.state='needs-decision'; $pair.State.last_error="Out-of-scope changes while blocked: $($outside -join ', ')"; Write-State $pair; throw $pair.State.last_error }
            Assert-NoActiveScopeOverlap $pair
            Invoke-StrictValidation
            $pair.State.state = 'in-progress'
            Set-ExecutionLease $pair $LeaseOwner
        }
        $pair.State.last_error = ''
        Write-State $pair
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'Start') {
        if ([string]$pair.State.state -ne 'planned') { throw "Task $TaskId cannot start from state $($pair.State.state)." }
        Assert-ReviewerWriteScope $pair.Contract $TaskId
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$governance.project.mode -eq 'TEAM_PROJECT' -and [string](Get-Property $pair.Contract 'role') -ne 'REVIEWER') {
            $review = Get-Property $pair.State 'review'
            $reviewerId = [string](Get-Property $review 'reviewer_task_id')
            if ([string](Get-Property $review 'required') -ne 'True' -or $reviewerId -notmatch '^TASK-\d{3,}$') { throw "TEAM_PROJECT task $TaskId must be assigned an independent reviewer before Start." }
            $reviewerPair = Read-TaskPair $reviewerId
            if ([string](Get-Property $reviewerPair.Contract 'role') -ne 'REVIEWER' -or [string]$reviewerPair.Contract.work_package -ne [string]$pair.Contract.work_package) { throw "TEAM_PROJECT task $TaskId reviewer is missing, not independent, or belongs to another work package." }
            if (@($reviewerPair.Contract.dependencies | Where-Object { [string]$_ -eq $TaskId }).Count -eq 0) { throw "Reviewer task $reviewerId must depend on $TaskId." }
        }
        if (@($pair.State.preexisting_changes).Count -gt 0) { throw "Task $TaskId was planned on a dirty code worktree: $(@($pair.State.preexisting_changes) -join ', '). Use an isolated clean worktree." }
        $newDirtyPaths = @(Get-ChangedPaths | Where-Object { -not (Test-SystemPath $_ $TaskId ([string]$pair.Contract.work_package)) })
        if ($newDirtyPaths.Count -gt 0) { throw "Task $TaskId worktree changed after planning: $($newDirtyPaths -join ', '). Re-plan from a clean execution point." }
        $governance = Read-GovernanceJson -Path $governancePath
        if ([string]$governance.current_baseline -ne [string]$pair.Contract.baseline) { throw "Task $TaskId is stale because the current baseline changed." }
        foreach ($dependencyId in @($pair.Contract.dependencies)) {
            $dependencyPair = Read-TaskPair ([string]$dependencyId)
            if (-not (Test-TaskDependencyReady $pair ([string]$dependencyId) $dependencyPair)) { throw "Task dependency $dependencyId is neither verified nor an explicit changes-required repair target." }
        }
        Assert-NoActiveScopeOverlap $pair
        if (@($pair.Contract.risk_flags).Count -gt 0 -or [string]$pair.Contract.profile -eq 'Release') { Assert-Approval -Id $TaskId -PlanHash $pair.Hash -Baseline ([string]$pair.Contract.baseline) -Type 'execution' -Approval $ApprovalId }
        Invoke-StrictValidation
        $pair.State.state = 'in-progress'; $pair.State.approval_id = if ($ApprovalId) { $ApprovalId } else { '' }
        $pair.State.start_git_commit = Get-GitCommit; Set-ExecutionLease $pair $LeaseOwner; $pair.State.last_error = ''
        Write-State $pair
        & (Join-Path $PSScriptRoot 'Get-TaskContext.ps1') -ProjectPath $root -WorkPackage ([string]$pair.Contract.work_package) -Profile ([string]$pair.Contract.profile) | Out-Null
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'Verify') {
        if ([string]$pair.State.state -notin @('in-progress', 'implemented')) { throw "Task $TaskId cannot verify from state $($pair.State.state)." }
        if ([string]$pair.State.state -eq 'in-progress') { Assert-ExecutionLeaseLive $pair $LeaseId $LeaseOwner }
        $outside = [System.Collections.Generic.List[string]]::new()
        foreach ($changed in @(Get-ChangedPaths -BaseCommit ([string]$pair.State.start_git_commit))) {
            if (Test-SystemPath $changed $TaskId ([string]$pair.Contract.work_package)) { continue }
            $matchingScopes = @(Get-TaskWritePaths $pair.Contract | Where-Object { Test-PathWithin $changed ([string]$_) })
            if ($matchingScopes.Count -eq 0) { $outside.Add($changed) }
        }
        if ($outside.Count -gt 0) {
            $pair.State.state = 'needs-decision'; $pair.State.last_error = "Out-of-scope changes: $($outside -join ', ')"; Clear-ExecutionLease $pair; Write-State $pair
            throw $pair.State.last_error
        }
        $pair.State.state = 'implemented'; Clear-ExecutionLease $pair; $pair.State.last_error = ''; Write-State $pair
        Assert-NoLinkedProjectPath "docs/05-quality/evidence/$TaskId"
        $evidenceDirectory = Join-Path $root "docs/05-quality/evidence/$TaskId"
        New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
        $evidencePaths = [System.Collections.Generic.List[string]]::new()
        $evidenceHistory = [System.Collections.Generic.List[string]]::new()
        foreach ($historicalEvidence in @($pair.State.evidence_history)) { if ($historicalEvidence) { $evidenceHistory.Add([string]$historicalEvidence) } }
        $runToken = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
        foreach ($validation in @($pair.Contract.validations)) {
            $validationId = [string]$validation.id
            $command = [string]$validation.command
            $arguments = @($validation.args | ForEach-Object { [string]$_ })
            if ([System.IO.Path]::IsPathRooted($command)) {
                $command = [System.IO.Path]::GetFullPath($command)
                if (-not (Test-Path -LiteralPath $command -PathType Leaf)) { throw "Absolute validation executable does not exist: $command" }
            } elseif ($command.Contains('/') -or $command.Contains('\')) {
                $relativeCommand = $command
                $command = [System.IO.Path]::GetFullPath((Join-Path $root $command))
                $prefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
                if (-not $command.StartsWith($prefix, $script:GovernancePathComparison) -or -not (Test-Path -LiteralPath $command -PathType Leaf)) { throw "Validation command escapes the project or does not exist: $command" }
                Assert-NoLinkedProjectPath $relativeCommand
            } elseif (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Validation command not found: $command" }
            $started = (Get-Date).ToUniversalTime().ToString('o'); $exitCode = 0; $output = ''
            $protectedBeforeValidation = Get-ProtectedGovernanceSnapshot
            Push-Location $root
            try { $global:LASTEXITCODE = 0; $output = (& $command @arguments 2>&1 | Out-String); if ($null -ne $LASTEXITCODE) { $exitCode = [int]$LASTEXITCODE } }
            catch { $output = ($_ | Out-String); $exitCode = 1 }
            finally { Pop-Location }
            $finished = (Get-Date).ToUniversalTime().ToString('o')
            $protectedAfterValidation = Get-ProtectedGovernanceSnapshot
            $protectedChanges = @(Compare-ProtectedGovernanceSnapshot -Before $protectedBeforeValidation -After $protectedAfterValidation)
            if ($protectedChanges.Count -gt 0) {
                $pair.State.state='needs-decision'; Clear-ExecutionLease $pair
                $pair.State.last_error="Validation $validationId modified governance-managed paths: $($protectedChanges -join ', ')"
                Write-GovernanceJson -Path $pair.Paths.State -Value $pair.State
                throw $pair.State.last_error
            }
            $protectedOutput = Protect-EvidenceOutput $output
            $outputRelative = "docs/05-quality/evidence/$TaskId/$runToken-$validationId.output.txt"
            $outputPath = Join-Path $root $outputRelative
            Write-AtomicUtf8Text -Path $outputPath -Content $protectedOutput.Content
            $evidenceRelative = "docs/05-quality/evidence/$TaskId/$runToken-$validationId.evidence.json"
            $evidence = [ordered]@{
                '$schema'='schemas/validation-evidence.schema.json'; schema_version=1; task_id=$TaskId; work_package=[string]$pair.Contract.work_package
                baseline=[string]$pair.Contract.baseline; contract_sha256=$pair.Hash; git_commit=(Get-GitCommit); validation_id=$validationId
                command=[string]$validation.command; args=$arguments; started_at=$started; finished_at=$finished; exit_code=$exitCode
                redactions_applied=[int]$protectedOutput.Count; output_path=$outputRelative; output_sha256=(Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
            }
            Write-GovernanceJson -Path (Join-Path $root $evidenceRelative) -Value $evidence
            $evidencePaths.Add($evidenceRelative)
            $evidenceHistory.Add($evidenceRelative)
            $postValidationOutside = [System.Collections.Generic.List[string]]::new()
            foreach ($changed in @(Get-ChangedPaths -BaseCommit ([string]$pair.State.start_git_commit))) {
                if (Test-SystemPath $changed $TaskId ([string]$pair.Contract.work_package)) { continue }
                if (@(Get-TaskWritePaths $pair.Contract | Where-Object { Test-PathWithin $changed ([string]$_) }).Count -eq 0) { $postValidationOutside.Add($changed) }
            }
            if ($postValidationOutside.Count -gt 0) {
                $pair.State.state='needs-decision'; Clear-ExecutionLease $pair; $pair.State.evidence=@($evidencePaths); $pair.State.evidence_history=@($evidenceHistory | Select-Object -Unique)
                $pair.State.last_error="Validation $validationId produced out-of-scope changes: $($postValidationOutside -join ', ')"; Write-State $pair; throw $pair.State.last_error
            }
            if ($exitCode -ne 0) { $pair.State.last_error = "Validation $validationId failed with exit code $exitCode."; $pair.State.evidence=@($evidencePaths); $pair.State.evidence_history=@($evidenceHistory | Select-Object -Unique); Write-State $pair; throw $pair.State.last_error }
        }
        $pair.State.state='verified'; Clear-ExecutionLease $pair; $pair.State.evidence=@($evidencePaths); $pair.State.evidence_history=@($evidenceHistory | Select-Object -Unique); $pair.State.last_error=''; Write-State $pair
        try { Invoke-StrictValidation -TaskProfile ([string]$pair.Contract.profile) } catch { $pair.State.state='implemented'; $pair.State.last_error=$_.Exception.Message; Write-State $pair; throw }
        Write-Output $pair.Paths.State
        return
    }

    if ($Action -eq 'Accept') {
        if ([string](Get-Property $pair.Contract 'role') -eq 'REVIEWER') { throw "REVIEWER tasks are completed by RecordReview and cannot be accepted independently." }
        if ([string]$pair.State.state -ne 'verified') { throw "Task $TaskId cannot be accepted from state $($pair.State.state)." }
        Assert-TeamReviewPassed $TaskId
        $acceptanceSnapshot = Get-AcceptanceSnapshot $pair $TaskId
        Assert-Approval -Id $TaskId -PlanHash $pair.Hash -Baseline ([string]$pair.Contract.baseline) -Type 'acceptance' -Approval $ApprovalId -SubjectSha256 $acceptanceSnapshot.SubjectSha256 -EvidenceSha256 $acceptanceSnapshot.EvidenceSha256
        $acceptanceStateSnapshot = [System.IO.File]::ReadAllText($pair.Paths.State, $script:GovernanceUtf8NoBom)
        $acceptanceGovernance = Read-GovernanceJson -Path $governancePath
        $isTeamAcceptance = [string]$acceptanceGovernance.project.mode -eq 'TEAM_PROJECT'
        $acceptanceLedgerPath = ''
        $acceptanceLedgerSnapshot = ''
        if ($isTeamAcceptance) {
            $acceptanceLedgerPath = [System.IO.Path]::GetFullPath((Join-Path $root ([string]$acceptanceGovernance.authoritative_documents.task_ledger)))
            $acceptanceLedgerSnapshot = [System.IO.File]::ReadAllText($acceptanceLedgerPath, $script:GovernanceUtf8NoBom)
        }
        $acceptanceWorkStatusSnapshot = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
        try {
            $pair.State.state='accepted'; $pair.State.approval_id=$ApprovalId; $pair.State.acceptance_subject_sha256=$acceptanceSnapshot.SubjectSha256; $pair.State.acceptance_evidence_sha256=$acceptanceSnapshot.EvidenceSha256; $pair.State.acceptance_git_commit=Get-GitCommit; $pair.State.last_error=''; Write-State $pair
        Invoke-StrictValidation -TaskProfile ([string]$pair.Contract.profile)
        } catch {
            Write-AtomicUtf8Text -Path $pair.Paths.State -Content $acceptanceStateSnapshot
            if ($isTeamAcceptance) { Write-AtomicUtf8Text -Path $acceptanceLedgerPath -Content $acceptanceLedgerSnapshot }
            Write-AtomicUtf8Text -Path $workStatusPath -Content $acceptanceWorkStatusSnapshot
            throw
        }
        Write-Output $pair.Paths.State
        return
    }
    } finally {
        if (Test-Path -LiteralPath $transactionJournalPath -PathType Leaf) { Remove-Item -LiteralPath $transactionJournalPath -Force }
    }
}
