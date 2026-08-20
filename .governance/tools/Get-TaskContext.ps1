[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [Parameter(Mandatory = $true)][ValidatePattern('^WP-\d{3,}$')][string]$WorkPackage,
    [ValidateSet("Lite", "Standard", "Release")][string]$Profile,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$root = [System.IO.Path]::GetFullPath($ProjectPath)
$script:pathComparison = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
$statePath = Join-Path $root "governance.json"
$routePath = Join-Path $root "docs/04-delivery/context/$WorkPackage.context.json"
$registryPath = Join-Path $root "docs/00-index/DOC-REGISTRY.md"
$currentStatePath = Join-Path $root "docs/00-index/CURRENT-STATE.md"
$workStatusPath = Join-Path $root "docs/04-delivery/WORK-STATUS.md"
$agentsPath = Join-Path $root "AGENTS.md"
foreach ($required in @($statePath, $routePath, $registryPath, $currentStatePath, $workStatusPath, $agentsPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required context source not found: $required" }
}

function Resolve-ContextPath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [System.IO.Path]::IsPathRooted($RelativePath)) { throw "Invalid context source path: $RelativePath" }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    $prefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, $script:pathComparison)) { throw "Context source path escapes the project root: $RelativePath" }
    $current = $root
    foreach ($segment in @($RelativePath.Replace('\', '/').Trim('/') -split '/')) {
        if (-not $segment) { continue }
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Context source path traverses a symbolic link or junction: $RelativePath" }
        }
    }
    return $candidate
}

function Get-RoutingSummary {
    param([Parameter(Mandatory = $true)][string]$Content)
    if ($Content -match '(?m)^summary:\s*(.+?)\s*$') { return $Matches[1].Trim().Trim([char]39, [char]34) }
    $withoutFrontMatter = [regex]::Replace($Content, '(?s)^\s*---\s*\r?\n.*?\r?\n---\s*', '')
    $lines = @($withoutFrontMatter -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $candidate = ($lines | Select-Object -First 8) -join [Environment]::NewLine
    if ($candidate.Length -gt 800) { $candidate = $candidate.Substring(0, 800) + "…" }
    return "[routing excerpt; open the full source before relying on details]`n$candidate"
}

$state = Read-GovernanceJson -Path $statePath
if ([string]::IsNullOrWhiteSpace($Profile)) { $Profile = [string]$state.task_profile }
if ($Profile -notin @("Lite", "Standard", "Release")) { throw "Invalid task context profile: $Profile" }
$profilePolicy = $state.context_policy.$Profile
if ($null -eq $profilePolicy) { throw "Missing context policy for profile $Profile in governance.json." }
$targetChars = [int]$profilePolicy.target_chars
$warningChars = [int]$profilePolicy.warning_chars
if ($targetChars -le 0 -or $warningChars -lt $targetChars) { throw "Invalid soft context budget for ${Profile}: target=$targetChars warning=$warningChars" }
if ($state.context_policy.required_documents_override_budget -ne $true -or $state.context_policy.allow_silent_truncation -ne $false) {
    throw "Context policy must allow required documents to override the budget and forbid silent truncation."
}

try { $route = [System.IO.File]::ReadAllText($routePath, $script:GovernanceUtf8NoBom) | ConvertFrom-Json -ErrorAction Stop }
catch { throw "Invalid work-package context route at ${routePath}: $($_.Exception.Message)" }
if ([string]$route.'$schema' -ne "schemas/work-package-context.schema.json" -or [int]$route.schema_version -ne 1) { throw "Unsupported work-package context route schema: $routePath" }
if ([string]$route.work_package -ne $WorkPackage) { throw "Context route work_package does not match $WorkPackage`: $routePath" }
if ([string]$route.baseline -ne [string]$state.current_baseline) { throw "Context route baseline $($route.baseline) does not match current baseline $($state.current_baseline)." }
foreach ($arrayField in @("scope", "required_documents", "decisions", "validation")) {
    if ($route.$arrayField -isnot [System.Array]) { throw "Context route field '$arrayField' must be an array: $routePath" }
}
if (@($route.scope).Count -eq 0 -or @($route.validation).Count -eq 0 -or @($route.required_documents).Count -eq 0) { throw "Context route must declare scope, required_documents, and validation: $routePath" }
if (@($route.scope | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) { throw "Context route scope entries must be non-empty strings: $routePath" }
if (@($route.validation | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) { throw "Context route validation entries must be non-empty strings: $routePath" }
$routeHash = (Get-FileHash -LiteralPath $routePath -Algorithm SHA256).Hash.ToLowerInvariant()

$registryText = [System.IO.File]::ReadAllText($registryPath, $script:GovernanceUtf8NoBom)
$registryEntries = @{}
foreach ($line in ($registryText -split "\r?\n")) {
    if ($line -notmatch '^\s*\|(.+)\|\s*$') { continue }
    $cells = @($Matches[1] -split '\|' | ForEach-Object { $_.Trim() })
    if ($cells.Count -ge 2 -and $cells[0] -match '^[A-Z][A-Z0-9-]+$') { $registryEntries[$cells[0]] = $cells[1] }
}

$sections = [System.Collections.Generic.List[string]]::new()
$sourceRecords = [System.Collections.Generic.List[object]]::new()
$seenSources = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
function Add-ContextSource {
    param([string]$Label, [string]$RelativePath, [ValidateSet("full", "summary")][string]$Mode = "full")
    if (-not $seenSources.Add($RelativePath)) { return }
    $resolved = Resolve-ContextPath -RelativePath $RelativePath
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Context source does not exist: $RelativePath" }
    $content = [System.IO.File]::ReadAllText($resolved, $script:GovernanceUtf8NoBom)
    $included = if ($Mode -eq "summary") { Get-RoutingSummary -Content $content } else { $content }
    $hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    $sourceRecords.Add([pscustomobject]@{ Label=$Label; Path=$RelativePath; Mode=$Mode; Hash=$hash })
    $sections.Add("## $Label`n`nSOURCE: $RelativePath`nMODE: $Mode`nSHA256: $hash`n`n$included")
}

Add-ContextSource -Label "Agent rules" -RelativePath "AGENTS.md"
Add-ContextSource -Label "Governance state" -RelativePath "governance.json"
Add-ContextSource -Label "Current state" -RelativePath "docs/00-index/CURRENT-STATE.md"

$workStatus = [System.IO.File]::ReadAllText($workStatusPath, $script:GovernanceUtf8NoBom)
$statusMatch = [regex]::Match($workStatus, "(?m)^\|\s*$([regex]::Escape($WorkPackage))\s*\|.*$")
if (-not $statusMatch.Success) { throw "WORK-STATUS.md does not contain $WorkPackage." }
$statusHash = (Get-FileHash -LiteralPath $workStatusPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceRecords.Add([pscustomobject]@{ Label="Work-package status"; Path="docs/04-delivery/WORK-STATUS.md"; Mode="row"; Hash=$statusHash })
$sections.Add("## Work-package status`n`nSOURCE: docs/04-delivery/WORK-STATUS.md`nMODE: row`nSHA256: $statusHash`n`n$($statusMatch.Value)")

$seenDocumentIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($document in @($route.required_documents)) {
    if ($null -eq $document -or $document -is [string] -or $document -is [ValueType]) { throw "Context route required_documents entries must be objects: $routePath" }
    $docId = [string]$document.doc_id
    $mode = [string]$document.mode
    $documentProperties = @($document.PSObject.Properties.Name)
    if (-not $document.PSObject.Properties["doc_id"] -or -not $document.PSObject.Properties["mode"] -or @($documentProperties | Where-Object { $_ -notin @("doc_id", "mode") }).Count -gt 0) { throw "Context route required_documents entry has an invalid structure: $routePath" }
    if ($docId -notmatch '^[A-Z][A-Z0-9-]+$') { throw "Context route contains an invalid document id: $docId" }
    if (-not $seenDocumentIds.Add($docId)) { throw "Context route contains a duplicate required document: $docId" }
    if ($mode -notin @("full", "summary")) { throw "Context route uses an invalid document mode '$mode' for $docId." }
    if (-not $registryEntries.ContainsKey($docId)) { throw "Context route references an unregistered document: $docId" }
    Add-ContextSource -Label "Document $docId" -RelativePath ([string]$registryEntries[$docId]) -Mode $mode
}
$seenDecisions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($decisionId in @($route.decisions)) {
    $decision = [string]$decisionId
    if ($decisionId -isnot [string] -or $decision -notmatch '^DEC-\d{3,}$' -or -not $seenDecisions.Add($decision)) { throw "Context route contains an invalid or duplicate decision: $decision" }
    if (-not $registryEntries.ContainsKey($decision)) { throw "Context route references an unregistered decision: $decision" }
    Add-ContextSource -Label "Decision $decision" -RelativePath ([string]$registryEntries[$decision]) -Mode "full"
}

$body = $sections -join "`n`n"
$contextChars = $body.Length
$budgetStatus = if ($contextChars -le $targetChars) { "within-target" } elseif ($contextChars -le $warningChars) { "target-exceeded" } else { "warning-exceeded" }
$scopeText = @($route.scope) -join ", "
$validationText = @($route.validation | ForEach-Object { "- $_" }) -join [Environment]::NewLine
$sourceText = @($sourceRecords | ForEach-Object { "- $($_.Path) [$($_.Mode)] $($_.Hash)" }) -join [Environment]::NewLine
$header = @"
# Generated task context: $WorkPackage

CONTEXT_PROFILE: $Profile
BASELINE: $($state.current_baseline)
SCOPE: $scopeText
CONTEXT_ROUTE: docs/04-delivery/context/$WorkPackage.context.json
CONTEXT_ROUTE_SHA256: $routeHash
CONTEXT_DOCUMENTS: $($sourceRecords.Count)
CONTEXT_CHARS: $contextChars
TARGET_CHARS: $targetChars
WARNING_CHARS: $warningChars
BUDGET_STATUS: $budgetStatus
SILENT_TRUNCATION: forbidden

This file is derived navigation context, not an authoritative source. Summary sections are routing aids; open their full source before relying on exact requirements or constraints.

## Required validation

$validationText

## Included sources

$sourceText
"@
$generated = $header.TrimEnd() + "`n`n" + $body + [Environment]::NewLine

if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $root ".governance/context/$WorkPackage.generated.md" }
else {
    $candidateOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) { [System.IO.Path]::GetFullPath($OutputPath) } else { [System.IO.Path]::GetFullPath((Join-Path $root $OutputPath)) }
    $rootPrefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidateOutput.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Context output path escapes the project root: $OutputPath" }
    $OutputPath = $candidateOutput
}
Write-AtomicUtf8Text -Path $OutputPath -Content $generated
if ($budgetStatus -eq "target-exceeded") { Write-Warning "Context exceeds the soft target but remains below the warning threshold; required content was not truncated." }
elseif ($budgetStatus -eq "warning-exceeded") { Write-Warning "Context exceeds the warning threshold; required content was not truncated. Split the work package or raise the task profile if this persists." }
Write-Host "Context profile: $Profile; chars=$contextChars; target=$targetChars; warning=$warningChars; status=$budgetStatus"
Write-Output $OutputPath
