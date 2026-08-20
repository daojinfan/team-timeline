$script:GovernanceUtf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-Property([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Invoke-GovernanceGitOutput {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& git -c "safe.directory=$($ProjectRoot.Replace('\', '/'))" -C $ProjectRoot @Arguments 2>$null)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) { throw "Git command failed: git $($Arguments -join ' ')" }
    return $output
}

function Get-GovernanceGitChangedEntries {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [string]$BaseCommit = ''
    )
    $head = @(Invoke-GovernanceGitOutput -ProjectRoot $ProjectRoot -Arguments @('rev-parse', 'HEAD'))
    if ($head.Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$head[0])) { throw 'Governed execution requires a Git repository with an initial commit.' }
    $pathComparer = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }
    $entries = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new($pathComparer)
    $diffBase = if ([string]::IsNullOrWhiteSpace($BaseCommit)) { 'HEAD' } else { $BaseCommit }
    foreach ($line in @(Invoke-GovernanceGitOutput -ProjectRoot $ProjectRoot -Arguments @('diff', '--name-status', '-M', $diffBase, '--'))) {
        if ([string]::IsNullOrWhiteSpace([string]$line)) { continue }
        $parts = @(([string]$line) -split "`t")
        $status = [string]$parts[0]
        if ($status -match '^R\d+$' -and $parts.Count -ge 3) {
            $oldPath = ([string]$parts[1]).Trim().Replace('\', '/')
            $newPath = ([string]$parts[2]).Trim().Replace('\', '/')
            $key = "renamed|$oldPath|$newPath"
            if ($seen.Add($key)) { $entries.Add([pscustomobject]@{ path=$newPath; old_path=$oldPath; change_type='renamed' }) }
            continue
        }
        if ($parts.Count -lt 2) { continue }
        $changeType = switch ($status.Substring(0, 1)) { 'A' { 'added' } 'M' { 'modified' } 'T' { 'modified' } 'U' { 'modified' } 'D' { 'deleted' } 'C' { 'added' } default { $null } }
        if ($null -eq $changeType) { continue }
        $path = ([string]$parts[1]).Trim().Replace('\', '/')
        $key = "$changeType|$path"
        if ($path -and $seen.Add($key)) { $entries.Add([pscustomobject]@{ path=$path; old_path=''; change_type=$changeType }) }
    }
    foreach ($path in @(Invoke-GovernanceGitOutput -ProjectRoot $ProjectRoot -Arguments @('ls-files', '--others', '--exclude-standard'))) {
        if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
        $normalized = ([string]$path).Trim().Replace('\', '/')
        if ($normalized -and $seen.Add("added|$normalized")) { $entries.Add([pscustomobject]@{ path=$normalized; old_path=''; change_type='added' }) }
    }
    return @($entries)
}

function Get-GovernanceGitEntriesSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][object[]]$Entries
    )
    $rootPath = [System.IO.Path]::GetFullPath($ProjectRoot)
    $rootPrefix = $rootPath.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    $comparison = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in @($Entries)) {
        $path = ([string](Get-Property $entry 'path')).Replace('\', '/').Trim('/')
        $oldPath = ([string](Get-Property $entry 'old_path')).Replace('\', '/').Trim('/')
        $changeType = [string](Get-Property $entry 'change_type')
        $contentHash = ''
        if ($changeType -ne 'deleted') {
            $resolved = [System.IO.Path]::GetFullPath((Join-Path $rootPath $path))
            if (-not $resolved.StartsWith($rootPrefix, $comparison) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Cannot hash reviewed Git entry outside the project or without file content: $path" }
            $contentHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        $lines.Add("$($changeType.Length):$changeType$($oldPath.Length):$oldPath$($path.Length):$path$($contentHash.Length):$contentHash")
    }
    $payload = (@($lines) | Sort-Object) -join "`n"
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($script:GovernanceUtf8NoBom.GetBytes($payload)))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Get-GovernanceFileSetSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )
    $rootPath = [System.IO.Path]::GetFullPath($ProjectRoot)
    $rootPrefix = $rootPath.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    $comparison = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($relativePath in @($RelativePaths | Sort-Object -Unique)) {
        $normalized = ([string]$relativePath).Replace('\', '/').Trim('/')
        if ([string]::IsNullOrWhiteSpace($normalized)) { throw 'Cannot fingerprint an empty evidence path.' }
        $resolved = [System.IO.Path]::GetFullPath((Join-Path $rootPath $normalized))
        if (-not $resolved.StartsWith($rootPrefix, $comparison) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Cannot fingerprint evidence outside the project or without file content: $normalized" }
        $contentHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
        $lines.Add("$($normalized.Length):$normalized$($contentHash.Length):$contentHash")
    }
    if ($lines.Count -eq 0) { throw 'Cannot fingerprint an empty evidence set.' }
    $payload = (@($lines) | Sort-Object) -join "`n"
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($script:GovernanceUtf8NoBom.GetBytes($payload)))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Read-GovernanceJson {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Governance state not found: $Path"
    }
    try {
        return ([System.IO.File]::ReadAllText($Path, $script:GovernanceUtf8NoBom) | ConvertFrom-Json)
    } catch {
        throw "Invalid governance JSON at ${Path}: $($_.Exception.Message)"
    }
}

function Set-ObjectProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )
    if ($Object.PSObject.Properties[$Name]) { $Object.$Name = $Value }
    else { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}

function Write-AtomicUtf8Text {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )
    $directory = Split-Path -Parent $Path
    if ([string]::IsNullOrWhiteSpace($directory)) { $directory = (Get-Location).Path }
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory (".{0}.{1}.tmp" -f ([System.IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString("N"))
    try {
        [System.IO.File]::WriteAllText($temporary, $Content, $script:GovernanceUtf8NoBom)
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $backup = Join-Path $directory (".{0}.{1}.bak" -f ([System.IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString("N"))
            try { [System.IO.File]::Replace($temporary, $Path, $backup); Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
            catch [System.PlatformNotSupportedException] { Move-Item -LiteralPath $temporary -Destination $Path -Force }
        } else {
            Move-Item -LiteralPath $temporary -Destination $Path
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Write-AtomicBytes {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Content
    )
    if (Test-Path -LiteralPath $Path -PathType Container) {
        throw "Cannot replace a directory with a managed file: $Path"
    }
    $directory = Split-Path -Parent $Path
    if ([string]::IsNullOrWhiteSpace($directory)) { $directory = (Get-Location).Path }
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = Join-Path $directory (".{0}.{1}.tmp" -f ([System.IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString("N"))
    try {
        [System.IO.File]::WriteAllBytes($temporary, $Content)
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $backup = Join-Path $directory (".{0}.{1}.bak" -f ([System.IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString("N"))
            try { [System.IO.File]::Replace($temporary, $Path, $backup); Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
            catch [System.PlatformNotSupportedException] { Move-Item -LiteralPath $temporary -Destination $Path -Force }
        } else {
            Move-Item -LiteralPath $temporary -Destination $Path
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Write-GovernanceJson {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value)
    Write-AtomicUtf8Text -Path $Path -Content (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
}

function Invoke-WithGovernanceLock {
    param(
        [Parameter(Mandatory = $true)][string]$LockPath,
        [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock,
        [int]$TimeoutSeconds = 30
    )
    $directory = Split-Path -Parent $LockPath
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $stream = $null
    while ($null -eq $stream) {
        try {
            $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch [System.IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for governance lock: $LockPath" }
            Start-Sleep -Milliseconds 100
        }
    }
    try { & $ScriptBlock } finally { $stream.Dispose() }
}

function Add-MarkdownRegistryEntry {
    param(
        [Parameter(Mandatory = $true)][string]$RegistryPath,
        [Parameter(Mandatory = $true)][string]$Entry,
        [string]$UniqueId
    )
    if (-not (Test-Path -LiteralPath $RegistryPath -PathType Leaf)) {
        throw "Required registry not found: $RegistryPath"
    }
    $lockPath = Join-Path (Split-Path -Parent $RegistryPath) (".{0}.lock" -f ([System.IO.Path]::GetFileName($RegistryPath)))
    Invoke-WithGovernanceLock -LockPath $lockPath -ScriptBlock {
        $existing = [System.IO.File]::ReadAllText($RegistryPath, $script:GovernanceUtf8NoBom)
        if ($UniqueId -and $existing -match "(?m)^\|\s*$([regex]::Escape($UniqueId))\s*\|") {
            throw "Registry already contains $UniqueId`: $RegistryPath"
        }
        $updated = $existing.TrimEnd("`r", "`n") + [Environment]::NewLine + $Entry + [Environment]::NewLine
        Write-AtomicUtf8Text -Path $RegistryPath -Content $updated
    }
}

function Assert-SafeHumanText {
    param([Parameter(Mandatory = $true)][string]$Value, [string]$Name = "value")
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name cannot be empty." }
    foreach ($character in $Value.ToCharArray()) {
        if ([char]::IsControl($character)) { throw "$Name cannot contain control characters." }
    }
}

function Get-CurrentBaseline {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)
    $state = Read-GovernanceJson -Path (Join-Path $ProjectRoot "governance.json")
    return [string]$state.current_baseline
}

function Get-GovernanceSemanticRiskFlags {
    param([AllowEmptyString()][string]$Text = '')

    $risks = [System.Collections.Generic.List[string]]::new()
    if ($Text -match '(?i)(?:\bdeploy(?:ment|ed|ing)?\b|\brelease(?:d|s|ing)?\b|\bproduction\b|\bprod\b|发布|生产)') {
        $risks.Add('production_release')
    }
    if ($Text -match '(?i)(?:\bmigrat(?:e|ed|es|ing|ion|ions)\b|\bdatabases?\b|\bdelet(?:e[sd]?|ing|ion|ions)\b|\birreversible\b|批量写入|迁移|删除|不可逆)') {
        $risks.Add('data_model_or_migration')
    }
    if ($Text -match '(?i)(?:\bsecurity\b|\bprivacy\b|\bcompliance\b|\bpermissions?\b|\bauth\b|\bauthenticat(?:e|ed|es|ing|ion)\b|\bauthoriz(?:e|ed|es|ing|ation)\b|\bsecrets?\b|安全|隐私|合规|权限|密钥)') {
        $risks.Add('security_privacy_compliance')
    }
    return @($risks | Select-Object -Unique)
}
