[CmdletBinding(DefaultParameterSetName = 'DryRun')]
param(
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [Parameter(ParameterSetName = 'Apply')][switch]$Apply,
    [Parameter(DontShow = $true)][ValidateRange(0, 100000)][int]$FailAfterWriteCount = 0
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Governance-Tools.Common.ps1')

$root = [System.IO.Path]::GetFullPath($ProjectPath)
$runtimeRelative = '.governance/runtime/tasks'
$runtimePath = Join-Path $root $runtimeRelative
$manifestRelative = '.governance/runtime/legacy-task-migration.json'
$manifestPath = Join-Path $root $manifestRelative
$lockPath = Join-Path $root '.governance/runtime/.legacy-task-migration.lock'
$pathComparison = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }

if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Project path does not exist: $root" }
if (-not (Test-Path -LiteralPath $runtimePath -PathType Container)) { throw "Governed task runtime does not exist: $runtimePath" }
if ((Get-Item -LiteralPath $runtimePath -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Governed task runtime cannot be a symbolic link or junction: $runtimePath" }

function Get-BytesSha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Get-JsonSha256 {
    param([Parameter(Mandatory = $true)]$Value)
    $json = ConvertTo-Json -InputObject $Value -Depth 30 -Compress
    return Get-BytesSha256 -Bytes $script:GovernanceUtf8NoBom.GetBytes($json)
}

function Read-JsonBytes {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required migration input not found: $Path" }
    if ((Get-Item -LiteralPath $Path -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Migration input cannot be a symbolic link: $Path" }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    try { $value = $script:GovernanceUtf8NoBom.GetString($bytes) | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "Invalid migration JSON at ${Path}: $($_.Exception.Message)" }
    return [pscustomobject]@{ Bytes = $bytes; Hash = Get-BytesSha256 -Bytes $bytes; Value = $value }
}

function Get-StringArray {
    param($Value)
    return @($Value | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ } | Select-Object -Unique)
}

function Assert-LegacyProjectPath {
    param([Parameter(Mandatory = $true)][string]$Value, [Parameter(Mandatory = $true)][string]$TaskId)
    if ([System.IO.Path]::IsPathRooted($Value) -or $Value -match '(^|[/\\])\.\.([/\\]|$)' -or $Value -in @('.', '*')) { throw "Legacy task $TaskId contains an unsafe allowed path: $Value" }
}

function New-SupersededStateV2 {
    param([Parameter(Mandatory = $true)]$LegacyState, [Parameter(Mandatory = $true)][string]$Timestamp)
    return [ordered]@{
        '$schema' = 'schemas/governed-work-state.schema.json'
        schema_version = 2
        task_id = [string]$LegacyState.task_id
        work_package = [string]$LegacyState.work_package
        contract_sha256 = [string]$LegacyState.contract_sha256
        baseline = [string]$LegacyState.baseline
        state = 'superseded'
        approval_id = [string](Get-Property $LegacyState 'approval_id')
        acceptance_subject_sha256 = ''
        acceptance_evidence_sha256 = ''
        acceptance_git_commit = ''
        start_git_commit = [string](Get-Property $LegacyState 'start_git_commit')
        execution_lease = ''
        execution_lease_owner = ''
        execution_lease_expires_at = ''
        preexisting_changes = @((Get-Property $LegacyState 'preexisting_changes'))
        evidence = @((Get-Property $LegacyState 'evidence'))
        evidence_history = @((Get-Property $LegacyState 'evidence_history'))
        review_history = @()
        review = [ordered]@{ required = $true; reviewer_task_id = ''; status = 'cancelled'; evidence = @(); pass_streak = 0; subject_sha256 = '' }
        last_error = [string](Get-Property $LegacyState 'last_error')
        created_at = [string](Get-Property $LegacyState 'created_at')
        updated_at = $Timestamp
    }
}

function Test-ExistingManifestCurrent {
    param([Parameter(Mandatory = $true)]$Manifest)
    if ([string](Get-Property $Manifest '$schema') -ne 'schemas/legacy-task-migration.schema.json' -or [int](Get-Property $Manifest 'schema_version') -ne 1) { return $false }
    $expectedManifestHash = [string](Get-Property $Manifest 'manifest_sha256')
    $Manifest.PSObject.Properties.Remove('manifest_sha256')
    $actualManifestHash = Get-JsonSha256 -Value $Manifest
    Set-ObjectProperty -Object $Manifest -Name 'manifest_sha256' -Value $expectedManifestHash
    if ($expectedManifestHash -ne $actualManifestHash) { throw 'Existing legacy migration manifest hash is invalid.' }
    $manifestTaskIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($task in @($Manifest.tasks)) {
        $taskId = [string]$task.task_id
        if (-not $manifestTaskIds.Add($taskId)) { throw "Existing legacy migration manifest contains duplicate task: $taskId" }
        $contractPath = Join-Path $root ([string]$task.source_contract_path)
        $statePath = Join-Path $root ([string]$task.source_state_path)
        if (-not (Test-Path -LiteralPath $contractPath -PathType Leaf) -or -not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $false }
        if ((Get-FileHash -LiteralPath $contractPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$task.source_contract_sha256) { throw "Frozen legacy contract changed after migration: $taskId" }
        $currentStateHash = (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $expectedStateHash = if ([bool]$task.automatic_state_upgrade) { [string]$task.migrated_state_sha256 } else { [string]$task.source_state_sha256 }
        if ($currentStateHash -ne $expectedStateHash) { throw "Legacy task state changed after migration manifest binding: $taskId" }
    }
    $runtimeTaskIds = @(Get-ChildItem -LiteralPath $runtimePath -File -Filter 'TASK-*.state.json' | ForEach-Object { if ($_.BaseName -match '^(TASK-\d+)\.state$') { $Matches[1] } })
    foreach ($taskId in $runtimeTaskIds) {
        $state = Read-GovernanceJson -Path (Join-Path $runtimePath "$taskId.state.json")
        if ([int](Get-Property $state 'schema_version') -eq 1 -and -not $manifestTaskIds.Contains($taskId)) { return $false }
    }
    return $true
}

function New-MigrationPlan {
    param([Parameter(Mandatory = $true)][string]$Timestamp, [Parameter(Mandatory = $true)][string]$MigrationId, [Parameter(Mandatory = $true)][string]$BackupRelative)
    $taskEntries = [System.Collections.Generic.List[object]]::new()
    $stateWrites = [System.Collections.Generic.List[object]]::new()
    $ledgerRows = [System.Collections.Generic.List[object]]::new()
    $taskIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($stateFile in @(Get-ChildItem -LiteralPath $runtimePath -File -Filter 'TASK-*.state.json' | Sort-Object Name)) {
        $stateRecord = Read-JsonBytes -Path $stateFile.FullName
        $state = $stateRecord.Value
        if ([int](Get-Property $state 'schema_version') -ne 1) { continue }
        $taskId = [string](Get-Property $state 'task_id')
        if ($taskId -notmatch '^TASK-[0-9]{3,}$' -or $stateFile.Name -ne "$taskId.state.json" -or -not $taskIds.Add($taskId)) { throw "Invalid or duplicate legacy task state identity: $($stateFile.Name) -> $taskId" }
        $contractPath = Join-Path $runtimePath "$taskId.contract.json"
        $contractRecord = Read-JsonBytes -Path $contractPath
        $contract = $contractRecord.Value
        if ([int](Get-Property $contract 'schema_version') -ne 1) { throw "Legacy state $taskId must bind a schema v1 contract." }
        if ([string](Get-Property $contract 'task_id') -ne $taskId -or [string](Get-Property $contract 'work_package') -ne [string](Get-Property $state 'work_package') -or [string](Get-Property $contract 'baseline') -ne [string](Get-Property $state 'baseline')) { throw "Legacy contract/state identity mismatch: $taskId" }
        if ([string](Get-Property $state 'contract_sha256') -ne $contractRecord.Hash) { throw "Frozen legacy contract SHA mismatch: $taskId" }
        $allowedPaths = @(Get-StringArray (Get-Property $contract 'allowed_paths'))
        if ($allowedPaths.Count -eq 0) { throw "Legacy contract has no effective paths: $taskId" }
        foreach ($allowedPath in $allowedPaths) { Assert-LegacyProjectPath -Value $allowedPath -TaskId $taskId }
        $sourceState = [string](Get-Property $state 'state')
        if ($sourceState -notin @('planned', 'in-progress', 'implemented', 'verified', 'accepted', 'blocked', 'needs-decision', 'superseded')) { throw "Legacy task has an unsupported state: $taskId -> $sourceState" }
        $disposition = if ($sourceState -eq 'superseded') { 'historical-terminal' } elseif ($sourceState -eq 'accepted') { 'reopened-for-review' } else { 'pending-review' }
        $automaticUpgrade = $sourceState -eq 'superseded'
        $migratedStateHash = ''
        if ($automaticUpgrade) {
            $newState = New-SupersededStateV2 -LegacyState $state -Timestamp $Timestamp
            $newStateBytes = $script:GovernanceUtf8NoBom.GetBytes(($newState | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
            $migratedStateHash = Get-BytesSha256 -Bytes $newStateBytes
            $stateWrites.Add([pscustomobject]@{ Path = $stateFile.FullName; Relative = "$runtimeRelative/$($stateFile.Name)"; Original = $stateRecord.Bytes; Content = $newStateBytes })
        }
        $taskEntry = [ordered]@{
            task_id = $taskId
            work_package = [string](Get-Property $state 'work_package')
            title = [string](Get-Property $contract 'title')
            source_contract_path = "$runtimeRelative/$taskId.contract.json"
            source_contract_sha256 = $contractRecord.Hash
            source_state_path = "$runtimeRelative/$taskId.state.json"
            source_state_sha256 = $stateRecord.Hash
            source_state = $sourceState
            source_baseline = [string](Get-Property $state 'baseline')
            effective_role = 'IMPLEMENTER'
            effective_read_paths = $allowedPaths
            effective_write_paths = $allowedPaths
            review_required = $true
            disposition = $disposition
            execution_disposition = 'historical-pre-team-review'
            automatic_state_upgrade = $automaticUpgrade
            migrated_state_sha256 = $migratedStateHash
        }
        $taskEntries.Add([pscustomobject]$taskEntry)
        $dependencies = @((Get-Property $contract 'dependencies') | ForEach-Object { [string]$_ }) -join ', '
        $validationIds = @((Get-Property $contract 'validations') | ForEach-Object { [string](Get-Property $_ 'id') }) -join ', '
        $ledgerStatus = if ($automaticUpgrade) { 'replaced' } else { 'needs-attention' }
        $reviewStatus = if ($automaticUpgrade) { 'cancelled' } else { 'pending' }
        $progress = if ($automaticUpgrade) { 'Legacy v1 superseded; state upgraded to v2 with cancelled review; historical evidence retained.' } elseif ($sourceState -eq 'accepted') { 'Legacy acceptance reopened by manifest only; independent review and new human acceptance remain required.' } elseif ($sourceState -eq 'verified') { 'Legacy verification mapped only; independent review remains required before acceptance.' } else { "Legacy $sourceState mapped only; project manager must decide the safe continuation." }
        $ledgerRows.Add(@([string](Get-Property $state 'work_package'), $taskId, 'legacy', 'IMPLEMENTER', [string](Get-Property $contract 'title'), [string](Get-Property $state 'baseline'), 'historical workspace', $dependencies, $ledgerStatus, ($allowedPaths -join ', '), $validationIds, '', $reviewStatus, '', $progress))
    }
    if ($taskEntries.Count -eq 0) { throw 'No schema v1 governed task states were found.' }
    $taskSetHash = Get-JsonSha256 -Value @($taskEntries | Sort-Object task_id)
    $manifestBase = [ordered]@{
        '$schema' = 'schemas/legacy-task-migration.schema.json'
        schema_version = 1
        migration_id = $MigrationId
        generated_at = $Timestamp
        mode = 'apply'
        source_runtime = $runtimeRelative
        backup_directory = $BackupRelative
        contract_policy = 'frozen-sha256'
        state_policy = 'superseded-only-auto-upgrade'
        task_set_sha256 = $taskSetHash
        tasks = @($taskEntries | Sort-Object task_id)
        ledger_plan = [ordered]@{
            columns = @('work_package', 'task_id', 'host_id', 'role', 'title', 'baseline', 'environment', 'dependencies', 'status', 'deliverables', 'validation', 'reviewer_task_id', 'review_status', 'review_evidence', 'latest_progress')
            rows = @($ledgerRows)
            note = 'Plan only: insert or reconcile these canonical 15-column rows through the governed task lifecycle; this migration does not fabricate reviewer tasks, review evidence, execution approval, or acceptance.'
        }
    }
    $manifestHash = Get-JsonSha256 -Value $manifestBase
    $manifestBase.manifest_sha256 = $manifestHash
    $manifestBytes = $script:GovernanceUtf8NoBom.GetBytes(($manifestBase | ConvertTo-Json -Depth 30) + [Environment]::NewLine)
    return [pscustomobject]@{ Manifest = [pscustomobject]$manifestBase; ManifestBytes = $manifestBytes; StateWrites = @($stateWrites) }
}

$result = Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
    if (Test-Path -LiteralPath $manifestPath -PathType Container) { throw "Migration manifest path is a directory: $manifestPath" }
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        $existingManifest = Read-GovernanceJson -Path $manifestPath
        if (Test-ExistingManifestCurrent -Manifest $existingManifest) {
            return [pscustomobject]@{ mode = $(if ($Apply) { 'already-applied' } else { 'dry-run-existing' }); manifest_path = $manifestRelative; task_count = @($existingManifest.tasks).Count; automatic_upgrade_count = @($existingManifest.tasks | Where-Object automatic_state_upgrade).Count; manifest_sha256 = [string]$existingManifest.manifest_sha256; ledger_plan = $existingManifest.ledger_plan }
        }
        throw 'An existing legacy migration manifest does not cover the current v1 task set. Refuse to overwrite hash-bound migration history.'
    }
    $now = (Get-Date).ToUniversalTime()
    $timestamp = $now.ToString('o')
    $migrationId = 'LTM-{0}-{1}' -f $now.ToString('yyyyMMddTHHmmssfffZ'), ([guid]::NewGuid().ToString('N').Substring(0, 12))
    $backupRelative = '.governance/migration-backups/{0}' -f $migrationId
    $plan = New-MigrationPlan -Timestamp $timestamp -MigrationId $migrationId -BackupRelative $backupRelative
    if (-not $Apply) {
        return [pscustomobject]@{ mode = 'dry-run'; manifest_path = $manifestRelative; task_count = @($plan.Manifest.tasks).Count; automatic_upgrade_count = @($plan.StateWrites).Count; manifest_sha256 = [string]$plan.Manifest.manifest_sha256; ledger_plan = $plan.Manifest.ledger_plan; tasks = $plan.Manifest.tasks }
    }
    $backupPath = Join-Path $root $backupRelative
    [System.IO.Directory]::CreateDirectory($backupPath) | Out-Null
    $manifestExisted = Test-Path -LiteralPath $manifestPath -PathType Leaf
    $manifestOriginal = if ($manifestExisted) { [System.IO.File]::ReadAllBytes($manifestPath) } else { $null }
    foreach ($write in $plan.StateWrites) {
        $backupFile = Join-Path $backupPath $write.Relative
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $backupFile)) | Out-Null
        [System.IO.File]::WriteAllBytes($backupFile, $write.Original)
    }
    $transactionPath = Join-Path $backupPath 'transaction.json'
    $transaction = [ordered]@{ migration_id = $migrationId; status = 'prepared'; created_at = $timestamp; manifest_path = $manifestRelative; state_paths = @($plan.StateWrites | ForEach-Object Relative) }
    Write-GovernanceJson -Path $transactionPath -Value $transaction
    $writeCount = 0
    try {
        foreach ($write in $plan.StateWrites) {
            Write-AtomicBytes -Path $write.Path -Content $write.Content
            $writeCount++
            if ($FailAfterWriteCount -gt 0 -and $writeCount -ge $FailAfterWriteCount) { throw "Injected migration failure after $writeCount writes." }
        }
        Write-AtomicBytes -Path $manifestPath -Content $plan.ManifestBytes
        $transaction.status = 'committed'
        $transaction.completed_at = (Get-Date).ToUniversalTime().ToString('o')
        Write-GovernanceJson -Path $transactionPath -Value $transaction
    } catch {
        $migrationError = $_
        foreach ($write in $plan.StateWrites) { Write-AtomicBytes -Path $write.Path -Content $write.Original }
        if ($manifestExisted) { Write-AtomicBytes -Path $manifestPath -Content $manifestOriginal }
        elseif (Test-Path -LiteralPath $manifestPath -PathType Leaf) { Remove-Item -LiteralPath $manifestPath -Force }
        $transaction.status = 'rolled-back'
        $transaction.completed_at = (Get-Date).ToUniversalTime().ToString('o')
        $transaction.error = $migrationError.Exception.Message
        Write-GovernanceJson -Path $transactionPath -Value $transaction
        throw $migrationError
    }
    return [pscustomobject]@{ mode = 'applied'; manifest_path = $manifestRelative; backup_directory = $backupRelative; task_count = @($plan.Manifest.tasks).Count; automatic_upgrade_count = @($plan.StateWrites).Count; manifest_sha256 = [string]$plan.Manifest.manifest_sha256; ledger_plan = $plan.Manifest.ledger_plan }
}

Write-Output $result
