[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [Parameter(Mandatory = $true)][ValidatePattern('^WP-\d{3,}$')][string]$WorkPackage,
    [Parameter(Mandatory = $true)][string[]]$Scope,
    [string[]]$FullDocument = @(),
    [string[]]$SummaryDocument = @(),
    [string[]]$Decision = @(),
    [Parameter(Mandatory = $true)][string[]]$Validation,
    [ValidatePattern('^BL-\d{3,}$')][string]$Baseline
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$root = [System.IO.Path]::GetFullPath($ProjectPath)
$governancePath = Join-Path $root "governance.json"
$registryPath = Join-Path $root "docs/00-index/DOC-REGISTRY.md"
$workPackagesPath = Join-Path $root "docs/04-delivery/WORK-PACKAGES.md"
$workStatusPath = Join-Path $root "docs/04-delivery/WORK-STATUS.md"
$schemaPath = Join-Path $root "schemas/work-package-context.schema.json"
$contextDirectory = Join-Path $root "docs/04-delivery/context"
$routePath = Join-Path $contextDirectory "$WorkPackage.context.json"
foreach ($required in @($governancePath, $registryPath, $workPackagesPath, $workStatusPath, $schemaPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required work-package context source not found: $required" }
}

if ([string]::IsNullOrWhiteSpace($Baseline)) { $Baseline = Get-CurrentBaseline -ProjectRoot $root }
if ($Baseline -notmatch '^BL-\d{3,}$') { throw "Invalid baseline id: $Baseline" }
if ($Scope.Count -eq 0 -or $Validation.Count -eq 0) { throw "Scope and Validation must contain at least one value." }
foreach ($value in @($Scope) + @($Validation)) { Assert-SafeHumanText -Value ([string]$value) -Name "Scope/Validation" }

$workPackages = [System.IO.File]::ReadAllText($workPackagesPath, $script:GovernanceUtf8NoBom)
$workStatus = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
if ($workPackages -notmatch "(?m)^\|\s*$([regex]::Escape($WorkPackage))\s*\|") { throw "WORK-PACKAGES.md does not define $WorkPackage." }
$statusMatch = [regex]::Match($workStatus, "(?m)^\|\s*$([regex]::Escape($WorkPackage))\s*\|\s*([^|]+?)\s*\|")
if (-not $statusMatch.Success) { throw "WORK-STATUS.md does not contain $WorkPackage." }
if ($statusMatch.Groups[1].Value.Trim().ToLowerInvariant() -in @("accepted", "superseded")) {
    Write-Warning "$WorkPackage is terminal in WORK-STATUS.md; create a current route only if the package is being reassessed."
}

$registryEntries = @{}
foreach ($line in ([System.IO.File]::ReadAllLines($registryPath, $script:GovernanceUtf8NoBom))) {
    if ($line -notmatch '^\s*\|(.+)\|\s*$') { continue }
    $cells = @($Matches[1] -split '\|' | ForEach-Object { $_.Trim() })
    if ($cells.Count -ge 3 -and $cells[0] -match '^[A-Z][A-Z0-9-]+$') { $registryEntries[$cells[0]] = $cells }
}

$requiredDocuments = [System.Collections.Generic.List[object]]::new()
$seenDocuments = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($entry in @(
    @($FullDocument | ForEach-Object { [pscustomobject]@{ Id=[string]$_; Mode="full" } }) +
    @($SummaryDocument | ForEach-Object { [pscustomobject]@{ Id=[string]$_; Mode="summary" } })
)) {
    $docId = $entry.Id.Trim()
    if ($docId -notmatch '^[A-Z][A-Z0-9-]+$') { throw "Invalid document id: $docId" }
    if (-not $seenDocuments.Add($docId)) { throw "Document id is listed more than once: $docId" }
    if (-not $registryEntries.ContainsKey($docId)) { throw "Document is not registered in DOC-REGISTRY.md: $docId" }
    $requiredDocuments.Add([ordered]@{ doc_id=$docId; mode=$entry.Mode })
}
if ($requiredDocuments.Count -eq 0) { throw "At least one FullDocument or SummaryDocument is required." }

$decisions = [System.Collections.Generic.List[string]]::new()
$seenDecisions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($decisionIdValue in @($Decision)) {
    $decisionId = ([string]$decisionIdValue).Trim()
    if ($decisionId -notmatch '^DEC-\d{3,}$') { throw "Invalid decision id: $decisionId" }
    if (-not $seenDecisions.Add($decisionId)) { throw "Decision id is listed more than once: $decisionId" }
    if (-not $registryEntries.ContainsKey($decisionId)) { throw "Decision is not registered in DOC-REGISTRY.md: $decisionId" }
    $decisions.Add($decisionId)
}

$route = [ordered]@{
    '$schema' = "schemas/work-package-context.schema.json"
    schema_version = 1
    work_package = $WorkPackage
    baseline = $Baseline
    scope = @($Scope)
    required_documents = $requiredDocuments
    decisions = $decisions
    validation = @($Validation)
}
$lockPath = Join-Path $contextDirectory ".context-routes.lock"
Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
    if (Test-Path -LiteralPath $routePath) { throw "Work-package context route already exists: $routePath" }
    Write-AtomicUtf8Text -Path $routePath -Content (($route | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
}
Write-Output $routePath
