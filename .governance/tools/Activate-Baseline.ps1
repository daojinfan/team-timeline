[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [Parameter(Mandatory = $true)][ValidatePattern('^BL-\d{3,}$')][string]$Baseline,
    [Parameter(Mandatory = $true)][ValidatePattern('^APR-\d{3,}$')][string]$ApprovalId
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$root = [System.IO.Path]::GetFullPath($ProjectPath)
$registryPath = Join-Path $root "docs/00-index/BASELINE-REGISTRY.md"
$approvalPath = Join-Path $root "docs/00-index/APPROVAL-LOG.md"
$governancePath = Join-Path $root "governance.json"
$currentStatePath = Join-Path $root "docs/00-index/CURRENT-STATE.md"
$manifestPath = Join-Path $root "baselines/$Baseline/manifest.json"
$activationPath = Join-Path $root "baselines/$Baseline/activation.json"
foreach ($required in @($registryPath, $approvalPath, $governancePath, $currentStatePath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required baseline activation file not found: $required" }
}

function Assert-BaselineContentIntegrity {
    $manifest = $null
    try { $manifest = [System.IO.File]::ReadAllText($manifestPath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "Invalid baseline manifest at ${manifestPath}: $($_.Exception.Message)" }
    $schemaVersion = [int]$manifest.schema_version
    if ($schemaVersion -notin @(1, 2)) { throw "Unsupported baseline manifest schema_version: $schemaVersion" }
    if ([string]$manifest.baseline -ne $Baseline) { throw "Baseline manifest does not describe $Baseline`: $manifestPath" }
    if ($schemaVersion -eq 2 -and [int]$manifest.scope_version -ne 1) { throw "Unsupported baseline manifest scope_version: $($manifest.scope_version)" }
    $seenPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $seenRoutePackages = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $documentRegistryPath = Join-Path $root "docs/00-index/DOC-REGISTRY.md"
    if (-not (Test-Path -LiteralPath $documentRegistryPath -PathType Leaf)) { throw "Document registry is missing: $documentRegistryPath" }
    $registeredDocumentIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in ([System.IO.File]::ReadAllLines($documentRegistryPath, $script:GovernanceUtf8NoBom))) {
        if ($line -match '^\s*\|\s*([A-Z][A-Z0-9-]+)\s*\|') { [void]$registeredDocumentIds.Add($Matches[1]) }
    }
    foreach ($document in @($manifest.documents)) {
        $relative = [string]$document.path
        $expectedHash = [string]$document.sha256
        if ([string]::IsNullOrWhiteSpace($relative) -or [System.IO.Path]::IsPathRooted($relative)) { throw "Invalid baseline document path: $relative" }
        $resolved = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
        $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Baseline document path escapes the project root: $relative" }
        if (-not $seenPaths.Add($relative)) { throw "Duplicate baseline document path: $relative" }
        if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') { throw "Invalid baseline document hash: $relative" }
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Baseline document is missing: $relative" }
        $actualHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash.ToLowerInvariant()) { throw "Baseline document content has drifted: $relative" }
    }
    foreach ($route in @($manifest.context_routes)) {
        $relative = [string]$route.path
        $expectedHash = [string]$route.sha256
        $workPackage = [string]$route.work_package
        if ([string]::IsNullOrWhiteSpace($relative) -or [System.IO.Path]::IsPathRooted($relative)) { throw "Invalid baseline context route path: $relative" }
        $resolved = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
        $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Baseline context route path escapes the project root: $relative" }
        if (-not $seenPaths.Add($relative)) { throw "Duplicate baseline content path: $relative" }
        if ($workPackage -notmatch '^WP-\d{3,}$' -or [string]$route.baseline -ne $Baseline) { throw "Baseline context route does not describe $Baseline`: $relative" }
        if (-not $seenRoutePackages.Add($workPackage)) { throw "Duplicate work package in baseline context routes: $workPackage" }
        if ($relative.Replace('\', '/') -ne "docs/04-delivery/context/$workPackage.context.json") { throw "Baseline context route path does not match work package ${workPackage}: $relative" }
        if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') { throw "Invalid baseline context route hash: $relative" }
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Baseline context route is missing: $relative" }
        $actualHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash.ToLowerInvariant()) { throw "Baseline context route content has drifted: $relative" }
        try { $routeState = [System.IO.File]::ReadAllText($resolved, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "Invalid baseline context route at ${relative}: $($_.Exception.Message)" }
        if ([string]$routeState.work_package -ne $workPackage -or [string]$routeState.baseline -ne $Baseline) { throw "Baseline context route metadata is inconsistent: $relative" }
        if ([string]$routeState.'$schema' -ne "schemas/work-package-context.schema.json" -or [int]$routeState.schema_version -ne 1) { throw "Unsupported baseline context route schema: $relative" }
        foreach ($arrayField in @("scope", "required_documents", "decisions", "validation")) {
            if ($routeState.$arrayField -isnot [System.Array]) { throw "Baseline context route field '$arrayField' must be an array: $relative" }
        }
        if (@($routeState.scope).Count -eq 0 -or @($routeState.validation).Count -eq 0 -or @($routeState.required_documents).Count -eq 0) { throw "Baseline context route is incomplete: $relative" }
        if (@($routeState.scope | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0 -or @($routeState.validation | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) { throw "Baseline context route contains an invalid scope or validation entry: $relative" }
        $seenDocumentIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($document in @($routeState.required_documents)) {
            if ($null -eq $document -or $document -is [string] -or $document -is [ValueType]) { throw "Baseline context route required_documents entries must be objects: $relative" }
            $docId = [string]$document.doc_id
            $mode = [string]$document.mode
            $documentProperties = @($document.PSObject.Properties.Name)
            if (-not $document.PSObject.Properties["doc_id"] -or -not $document.PSObject.Properties["mode"] -or @($documentProperties | Where-Object { $_ -notin @("doc_id", "mode") }).Count -gt 0) { throw "Baseline context route contains an invalid required_documents entry: $relative" }
            if ($docId -notmatch '^[A-Z][A-Z0-9-]+$' -or -not $registeredDocumentIds.Contains($docId) -or -not $seenDocumentIds.Add($docId)) { throw "Baseline context route contains an invalid, unregistered, or duplicate document '$docId': $relative" }
            if ($mode -notin @("full", "summary")) { throw "Baseline context route contains an invalid document mode '$mode': $relative" }
        }
        foreach ($decision in @($routeState.decisions)) {
            $decisionId = [string]$decision
            if ($decisionId -notmatch '^DEC-\d{3,}$' -or -not $registeredDocumentIds.Contains($decisionId)) { throw "Baseline context route contains an invalid or unregistered decision '$decisionId': $relative" }
        }
    }
    $workStatusPath = Join-Path $root "docs/04-delivery/WORK-STATUS.md"
    if (-not (Test-Path -LiteralPath $workStatusPath -PathType Leaf)) { throw "Work-package status file is missing: $workStatusPath" }
    $routableStatuses = @("planned", "in-progress", "implemented", "verified", "blocked", "needs-decision")
    foreach ($line in ([System.IO.File]::ReadAllLines($workStatusPath, $script:GovernanceUtf8NoBom))) {
        if ($line -notmatch '^\s*\|\s*(WP-\d{3,})\s*\|\s*([^|]+?)\s*\|') { continue }
        $workPackage = $Matches[1]
        $status = $Matches[2].Trim().ToLowerInvariant()
        if ($status -in $routableStatuses -and -not $seenRoutePackages.Contains($workPackage)) { throw "Active work package $workPackage is missing a context route in baseline $Baseline." }
    }
}

$approvalLog = [System.IO.File]::ReadAllText($approvalPath, $script:GovernanceUtf8NoBom)
$approvalMatch = [regex]::Match($approvalLog, "(?ms)^\s*approval_id:\s*$([regex]::Escape($ApprovalId))\s*$.*?(?=^\s*approval_id:\s*APR-|\z)")
if (-not $approvalMatch.Success) { throw "Approval $ApprovalId is not recorded in APPROVAL-LOG.md." }
$approvalBlock = $approvalMatch.Value
if ($approvalBlock -notmatch '(?m)^\s*status:\s*approved\s*$') { throw "Approval $ApprovalId is not approved." }
if ($approvalBlock -notmatch '(?m)^\s*approval_type:\s*baseline\s*$') { throw "Approval $ApprovalId is not a baseline approval." }
if ($approvalBlock -notmatch "(?m)^\s*-\s*$([regex]::Escape($Baseline))\s*$") { throw "Approval $ApprovalId does not list $Baseline in approved_items." }

$lockPath = Join-Path $root ".governance/baseline-activation.lock"
Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
    Assert-BaselineContentIntegrity
    $registryOriginal = [System.IO.File]::ReadAllText($registryPath, $script:GovernanceUtf8NoBom)
    $currentOriginal = [System.IO.File]::ReadAllText($currentStatePath, $script:GovernanceUtf8NoBom)
    $governance = Read-GovernanceJson -Path $governancePath
    $governanceOriginal = ($governance | ConvertTo-Json -Depth 20) + [Environment]::NewLine

    $targetPattern = "(?m)^\|\s*$([regex]::Escape($Baseline))\s*\|"
    if ($registryOriginal -notmatch $targetPattern) { throw "Baseline $Baseline is not registered." }
    $alreadyActive = $registryOriginal -match "(?m)^\|\s*$([regex]::Escape($Baseline))\s*\|\s*active\s*\|"
    if ($alreadyActive -and [string]$governance.current_baseline -eq $Baseline) {
        $activeRow = [regex]::Match($registryOriginal, "(?m)^\|\s*$([regex]::Escape($Baseline))\s*\|\s*active\s*\|.*$")
        $activeColumns = $activeRow.Value.Split('|')
        if ($activeColumns.Count -lt 7 -or $activeColumns[5].Trim() -ne $ApprovalId) {
            throw "Existing active registry row for $Baseline does not reference approval $ApprovalId."
        }
        if (-not (Test-Path -LiteralPath $activationPath -PathType Leaf)) {
            throw "Active baseline $Baseline is missing activation evidence: $activationPath"
        }
        try { $existingActivation = [System.IO.File]::ReadAllText($activationPath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "Invalid activation evidence at ${activationPath}: $($_.Exception.Message)" }
        $existingActivatedAt = [DateTimeOffset]::MinValue
        if ([int]$existingActivation.schema_version -ne 1 -or
            [string]$existingActivation.baseline -ne $Baseline -or
            [string]$existingActivation.approval_id -ne $ApprovalId -or
            -not [DateTimeOffset]::TryParse([string]$existingActivation.activated_at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$existingActivatedAt) -or
            [string]$existingActivation.previous_baseline -notmatch '^BL-\d{3,}$') {
            throw "Activation evidence is inconsistent with active baseline $Baseline and approval $ApprovalId`: $activationPath"
        }
        Write-Output $activationPath
        return
    }
    if (Test-Path -LiteralPath $activationPath -PathType Leaf) { throw "Activation evidence already exists while $Baseline is not the current active baseline: $activationPath" }

    $lines = $registryOriginal -split "\r?\n"
    $foundTarget = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -notmatch '^\|\s*(BL-\d{3,})\s*\|') { continue }
        $rowId = $Matches[1]
        $columns = $lines[$index].Split('|')
        if ($columns.Count -lt 9) { continue }
        $status = $columns[2].Trim()
        if ($rowId -eq $Baseline) {
            if ($status -in @('superseded', 'archived', 'retired')) { throw "Cannot activate $Baseline from terminal status $status." }
            $columns[2] = ' active '
            $columns[5] = " $ApprovalId "
            $foundTarget = $true
        } elseif ($status -eq 'active') {
            $columns[2] = ' superseded '
        }
        $lines[$index] = $columns -join '|'
    }
    if (-not $foundTarget) { throw "Could not update the registry row for $Baseline." }
    $registryUpdated = $lines -join [Environment]::NewLine
    $activeCount = ([regex]::Matches($registryUpdated, '(?m)^\|\s*BL-\d{3,}\s*\|\s*active\s*\|')).Count
    if ($activeCount -ne 1) { throw "Activation would leave $activeCount active baselines; expected exactly one." }

    Set-ObjectProperty -Object $governance -Name "current_baseline" -Value $Baseline
    $currentUpdated = [regex]::Replace($currentOriginal, '(?m)^(-\s*当前基线：\s*)BL-\d{3,}\s*$', "`${1}$Baseline", 1)
    $activation = [ordered]@{
        schema_version = 1
        baseline = $Baseline
        approval_id = $ApprovalId
        activated_at = (Get-Date).ToUniversalTime().ToString("o")
        previous_baseline = [string]((Read-GovernanceJson -Path $governancePath).current_baseline)
    }
    $activationCreated = $false
    try {
        Write-AtomicUtf8Text -Path $activationPath -Content (($activation | ConvertTo-Json -Depth 10) + [Environment]::NewLine)
        $activationCreated = $true
        Write-AtomicUtf8Text -Path $registryPath -Content $registryUpdated
        Write-GovernanceJson -Path $governancePath -Value $governance
        Write-AtomicUtf8Text -Path $currentStatePath -Content $currentUpdated
    } catch {
        try { Write-AtomicUtf8Text -Path $registryPath -Content $registryOriginal } catch { }
        try { Write-AtomicUtf8Text -Path $governancePath -Content $governanceOriginal } catch { }
        try { Write-AtomicUtf8Text -Path $currentStatePath -Content $currentOriginal } catch { }
        if ($activationCreated -and (Test-Path -LiteralPath $activationPath)) { Remove-Item -LiteralPath $activationPath -Force }
        throw
    }
    Write-Output $activationPath
}
