[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Title,
    [string]$Owner = "human",
    [string]$Baseline,
    [ValidatePattern('^DEC-\d{3,}$')][string]$Id
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$root = [System.IO.Path]::GetFullPath($ProjectPath)
$directory = Join-Path $root "docs/07-decisions"
$template = Join-Path $directory "DEC-TEMPLATE.md"
$registryPath = Join-Path $root "docs/00-index/DOC-REGISTRY.md"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path -LiteralPath $template -PathType Leaf)) { throw "Decision template not found: $template" }
if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { throw "Required registry not found: $registryPath" }
$Title = ($Title -replace '[\r\n]+', ' ').Trim()
Assert-SafeHumanText -Value $Title -Name "Title"
Assert-SafeHumanText -Value $Owner -Name "Owner"
if ($Owner.Contains('|')) { throw "Owner cannot contain the Markdown table delimiter '|'." }

if ([string]::IsNullOrWhiteSpace($Baseline)) {
    $statePath = Join-Path $root "governance.json"
    if (Test-Path -LiteralPath $statePath) {
        $Baseline = Get-CurrentBaseline -ProjectRoot $root
    }
    if ([string]::IsNullOrWhiteSpace($Baseline)) { $Baseline = "BL-001" }
}
if ($Baseline -notmatch '^BL-\d{3,}$') { throw "Invalid baseline id: $Baseline" }

New-Item -ItemType Directory -Force -Path $directory | Out-Null
$templateContent = [System.IO.File]::ReadAllText($template, $utf8NoBom)
$ownerYaml = $Owner | ConvertTo-Json -Compress
$candidate = if ($Id) { [int]($Id.Substring(4)) } else { 1 }
if (-not $Id) {
    $numbers = @(Get-ChildItem -LiteralPath $directory -File -Filter "DEC-*.md" | Where-Object Name -match '^DEC-(\d+)\.md$' | ForEach-Object { [int]$Matches[1] })
    if ($numbers.Count -gt 0) { $candidate = [int](($numbers | Measure-Object -Maximum).Maximum) + 1 }
}

while ($true) {
    $decisionId = "DEC-{0:D3}" -f ([int]$candidate)
    $path = Join-Path $directory "$decisionId.md"
    $content = $templateContent.Replace("DEC-NNN", $decisionId)
    $content = $content.Replace("# 决策：标题", "# 决策：$Title")
    $content = [regex]::Replace($content, '(?m)^owner:\s*.*$', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) "owner: $ownerYaml" }, 1)
    $content = [regex]::Replace($content, '(?m)^baseline:\s*.*$', "baseline: $Baseline", 1)
    $content = $content.Replace("{{CURRENT_DATE}}", (Get-Date -Format "yyyy-MM-dd"))
    try {
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $bytes = $utf8NoBom.GetBytes($content)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
        break
    } catch [System.IO.IOException] {
        if ($Id) { throw "Decision already exists: $path" }
        $candidate++
    }
}

try {
    $entry = "| $decisionId | docs/07-decisions/$decisionId.md | decision | proposed | 1.0 | $Baseline | $Owner |"
    Add-MarkdownRegistryEntry -RegistryPath $registryPath -Entry $entry -UniqueId $decisionId
} catch {
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    throw
}
Write-Output $path
