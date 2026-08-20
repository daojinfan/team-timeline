[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [string]$Baseline,
    [ValidatePattern('^(APR-\d{3,}|pending)$')][string]$ApprovalId = "pending",
    [ValidateSet("draft", "proposed", "approved", "archived")][string]$Status = "proposed",
    [string]$Description = "",
    [switch]$AllowUnapproved
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$root = [System.IO.Path]::GetFullPath($ProjectPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$registryPath = Join-Path $root "docs/00-index/BASELINE-REGISTRY.md"
$baselineRoot = Join-Path $root "baselines"
$lockPath = Join-Path (Split-Path -Parent $registryPath) ".BASELINE-REGISTRY.md.lock"
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Project path does not exist: $root" }
if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { throw "Required registry not found: $registryPath" }
if ($Status -eq "approved" -and $ApprovalId -eq "pending") {
    throw "An approved baseline requires -ApprovalId. Create a proposed baseline before approval if no approval exists yet."
}
if ($AllowUnapproved) { Write-Warning "-AllowUnapproved is deprecated and has no effect; activation always requires a recorded approval." }
$Description = ($Description -replace '[\r\n]+', ' ').Trim()
if ($Description) { Assert-SafeHumanText -Value $Description -Name "Description" }

function Test-OperationalDocument {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    if ($RelativePath -like "docs/00-index/*" -or $RelativePath -like "docs/08-changes/*" -or $RelativePath -like "docs/09-reports/*") { return $true }
    return $RelativePath -in @(
        "docs/04-delivery/WORK-STATUS.md",
        "docs/04-delivery/TASK-LEDGER.md",
        "docs/05-quality/traceability.md"
    )
}

Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
    if ([string]::IsNullOrWhiteSpace($Baseline)) {
        $registeredText = [System.IO.File]::ReadAllText($registryPath, $utf8NoBom)
        $placeholder = [regex]::Match($registeredText, '(?m)^\|\s*(BL-\d{3,})\s*\|\s*(?:draft|proposed)\s*\|\s*(?:尚未生成|not generated)\s*\|')
        if ($placeholder.Success) { $Baseline = $placeholder.Groups[1].Value }
        else {
            $numbers = @(
                Get-ChildItem -LiteralPath $baselineRoot -Directory -Filter "BL-*" -ErrorAction SilentlyContinue | Where-Object Name -match '^BL-(\d+)$' | ForEach-Object { [int]$Matches[1] }
                [regex]::Matches($registeredText, '(?m)^\|\s*BL-(\d+)\s*\|') | ForEach-Object { [int]$_.Groups[1].Value }
            )
            $next = if ($numbers.Count -gt 0) { [int](($numbers | Measure-Object -Maximum).Maximum) + 1 } else { 1 }
            $Baseline = "BL-{0:D3}" -f ([int]$next)
        }
    }
    if ($Baseline -notmatch '^BL-\d{3,}$') { throw "Invalid baseline id: $Baseline" }
    $destination = Join-Path $baselineRoot $Baseline
    if (Test-Path -LiteralPath $destination) { throw "Baseline already exists: $destination" }

    $documents = [System.Collections.Generic.List[object]]::new()
    $operationalDocuments = [System.Collections.Generic.List[object]]::new()
    $docsRoot = Join-Path $root "docs"
    foreach ($file in @(Get-ChildItem -LiteralPath $docsRoot -Recurse -File -Filter "*.md" -ErrorAction SilentlyContinue)) {
        if ($file.Name -match "TEMPLATE|README") { continue }
        $relative = $file.FullName.Substring($root.Length + 1).Replace("\", "/")
        if (Test-OperationalDocument -RelativePath $relative) {
            $operationalDocuments.Add([ordered]@{ path = $relative })
            continue
        }
        $content = [System.IO.File]::ReadAllText($file.FullName, $utf8NoBom)
        $meta = @{}
        if ($content -match '(?s)^\s*---\s*\r?\n(.*?)\r?\n---') {
            foreach ($line in ($Matches[1] -split "\r?\n")) {
                if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$') { $meta[$Matches[1]] = $Matches[2].Trim().Trim([char]39,[char]34) }
            }
        }
        $documents.Add([ordered]@{
            doc_id = if ($meta.ContainsKey("doc_id")) { $meta.doc_id } else { $null }
            path = $relative
            version = if ($meta.ContainsKey("version")) { $meta.version } else { $null }
            status = if ($meta.ContainsKey("status")) { $meta.status } else { $null }
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        })
    }

    $contextRoutes = [System.Collections.Generic.List[object]]::new()
    $contextRoot = Join-Path $root "docs/04-delivery/context"
    foreach ($file in @(Get-ChildItem -LiteralPath $contextRoot -File -Filter "*.context.json" -ErrorAction SilentlyContinue)) {
        if ($file.Name -eq "WP-TEMPLATE.context.json") { continue }
        try { $route = [System.IO.File]::ReadAllText($file.FullName, $utf8NoBom) | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "Invalid work-package context route at $($file.FullName): $($_.Exception.Message)" }
        $workPackage = [string]$route.work_package
        $routeBaseline = [string]$route.baseline
        if ($workPackage -notmatch '^WP-\d{3,}$') { throw "Invalid work package in context route: $($file.FullName)" }
        if ($file.BaseName -ne "$workPackage.context") { throw "Context route filename does not match work_package ${workPackage}: $($file.Name)" }
        if ($routeBaseline -notmatch '^BL-\d{3,}$') { throw "Invalid baseline in context route ${workPackage}: $routeBaseline" }
        if ($routeBaseline -ne $Baseline) {
            Write-Warning "Skipping context route $workPackage because it targets $routeBaseline rather than $Baseline. Reassess it before activation if the work package remains active."
            continue
        }
        if ([string]$route.'$schema' -ne "schemas/work-package-context.schema.json" -or [int]$route.schema_version -ne 1) { throw "Unsupported work-package context route schema: $($file.FullName)" }
        foreach ($arrayField in @("scope", "required_documents", "decisions", "validation")) {
            if ($route.$arrayField -isnot [System.Array]) { throw "Context route field '$arrayField' must be an array: $($file.FullName)" }
        }
        if (@($route.scope).Count -eq 0 -or @($route.required_documents).Count -eq 0 -or @($route.validation).Count -eq 0) { throw "Context route is incomplete: $($file.FullName)" }
        $relative = $file.FullName.Substring($root.Length + 1).Replace("\", "/")
        $contextRoutes.Add([ordered]@{
            work_package = $workPackage
            baseline = $routeBaseline
            path = $relative
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        })
    }

    $gitCommit = "unknown"
    try {
        $gitCommit = (& git -c "safe.directory=$($root.Replace('\', '/'))" -C $root rev-parse HEAD 2>$null).Trim()
        if ([string]::IsNullOrWhiteSpace($gitCommit)) { $gitCommit = "unknown" }
    } catch { }
    $manifest = [ordered]@{
        schema_version = 2
        scope_version = 1
        baseline = $Baseline
        status_at_creation = $Status
        created_at = (Get-Date).ToUniversalTime().ToString("o")
        approval_id = $ApprovalId
        git_commit = $gitCommit
        documents = $documents
        operational_documents = $operationalDocuments
        context_routes = $contextRoutes
    }

    New-Item -ItemType Directory -Force -Path $baselineRoot | Out-Null
    $temporary = Join-Path $baselineRoot (".{0}.{1}.tmp" -f $Baseline, [guid]::NewGuid().ToString("N"))
    $published = $false
    try {
        New-Item -ItemType Directory -Path $temporary | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $temporary "manifest.json"), (($manifest | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $utf8NoBom)
        Move-Item -LiteralPath $temporary -Destination $destination
        $published = $true

        $date = Get-Date -Format "yyyy-MM-dd"
        $safeDescription = $Description.Replace("|", "\|")
        $entry = "| $Baseline | $Status | baselines/$Baseline/manifest.json | $gitCommit | $ApprovalId | $date | $safeDescription |"
        $registry = [System.IO.File]::ReadAllText($registryPath, $utf8NoBom)
        $rowPattern = "(?m)^\|\s*$([regex]::Escape($Baseline))\s*\|.*$"
        $existing = [regex]::Match($registry, $rowPattern)
        if ($existing.Success) {
            if ($existing.Value -notmatch '\|\s*(?:尚未生成|not generated)\s*\|') { throw "Registry already contains $Baseline`: $registryPath" }
            $updated = [regex]::Replace($registry, $rowPattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $entry }, 1)
        } else {
            $updated = $registry.TrimEnd("`r", "`n") + [Environment]::NewLine + $entry + [Environment]::NewLine
        }
        Write-AtomicUtf8Text -Path $registryPath -Content $updated
    } catch {
        if ($published -and (Test-Path -LiteralPath $destination -PathType Container)) { Remove-Item -LiteralPath $destination -Recurse -Force }
        throw
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
    Write-Output (Join-Path $destination "manifest.json")
}
