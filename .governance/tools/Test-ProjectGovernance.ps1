[CmdletBinding()]
param(
    [string]$ProjectPath = (Get-Location).Path,
    [ValidateSet("Basic", "Strict", "Release")]
    [string]$Level = "Release",
    [switch]$Strict,
    [switch]$AllowLegacyTaskStates
)

$ErrorActionPreference = "Stop"
if ($Strict -and (-not $PSBoundParameters.ContainsKey('Level') -or $Level -eq "Basic")) { $Level = "Strict" }
$levelRank = @{ Basic = 1; Strict = 2; Release = 3 }[$Level]
$root = [System.IO.Path]::GetFullPath($ProjectPath)
. (Join-Path $PSScriptRoot "Governance-Tools.Common.ps1")
$script:pathComparison = if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$migrationNotices = [System.Collections.Generic.List[string]]::new()
$compatibilityNotices = [System.Collections.Generic.List[string]]::new()

function Add-Error([string]$Message) { $script:errors.Add($Message) }
function Add-Warning([string]$Message) { $script:warnings.Add($Message) }
function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))
}
function Get-RelativePath([string]$Path) {
    return $Path.Substring($script:root.Length).TrimStart([char]92, [char]47).Replace([char]92, [char]47)
}
function Require-File([string]$RelativePath) {
    $path = Join-Path $script:root $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Add-Error "Missing required file: $RelativePath" }
}
function Test-PathWithinScope([string]$Path, [string]$Scope) {
    $pathValue = ([string]$Path).Replace('\', '/').Trim('/')
    $scopeValue = ([string]$Scope).Replace('\', '/').Trim('/')
    return $pathValue.Equals($scopeValue, $script:pathComparison) -or $pathValue.StartsWith($scopeValue + '/', $script:pathComparison)
}
function Test-ReviewSystemPath([string]$Path, [string]$WorkPackage) {
    $normalized = ([string]$Path).Replace('\', '/').Trim('/')
    return $normalized.StartsWith('.governance/runtime/tasks/', $script:pathComparison) -or
        $normalized.Equals(".governance/context/$WorkPackage.generated.md", $script:pathComparison) -or
        $normalized.Equals('docs/04-delivery/WORK-STATUS.md', $script:pathComparison) -or
        $normalized.Equals('docs/04-delivery/TASK-LEDGER.md', $script:pathComparison) -or
        $normalized.Equals('docs/00-index/APPROVAL-LOG.md', $script:pathComparison) -or
        $normalized.StartsWith('docs/05-quality/evidence/', $script:pathComparison)
}

# This intentionally parses only the small, documented front-matter subset used by
# this framework. It supports scalars, [] lists, inline lists, and indented lists.
function Get-FrontMatter([string]$Content) {
    if ($Content -notmatch '(?s)^\s*---\s*\r?\n(.*?)\r?\n---(?:\s*\r?\n|\s*$)') { return $null }
    $values = @{}
    $currentKey = $null
    foreach ($line in ($Matches[1] -split "\r?\n")) {
        if ($line -match '^\s+\-\s*(.*?)\s*$' -and $currentKey) {
            $values[$currentKey] = @($values[$currentKey]) + $Matches[1].Trim().Trim([char]39, [char]34)
            continue
        }
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$') {
            $currentKey = $Matches[1]
            $raw = $Matches[2].Trim()
            if ($raw -eq '' -or $raw -eq '[]' -or $raw -eq 'null' -or $raw -eq '~') {
                $values[$currentKey] = @()
            } elseif ($raw -match '^\[(.*)\]$') {
                $inner = $Matches[1].Trim()
                $values[$currentKey] = if ($inner) { @($inner -split '\s*,\s*' | ForEach-Object { $_.Trim().Trim([char]39, [char]34) }) } else { @() }
            } else {
                $values[$currentKey] = $raw.Trim([char]39, [char]34)
            }
        }
    }
    return $values
}

function Get-Property([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-RequiredReviewRounds([object]$Contract) {
    if ([string](Get-Property $Contract 'profile') -eq 'Lite') { return 1 }
    return 2
}

function Get-ProfileRank([string]$Value) { return @{ Lite=1; Standard=2; Release=3 }[[string]$Value] }

function Get-MinimumTaskProfile([object]$Contract) {
    $risks = @((Get-Property $Contract 'risk_flags'))
    if (@($risks | Where-Object { $_ -in @('data_model_or_migration', 'security_privacy_compliance', 'quality_gate_exception', 'production_release', 'irreversible_operation') }).Count -gt 0) { return 'Release' }
    if (@($risks | Where-Object { $_ -in @('scope', 'success_criteria', 'overall_architecture', 'public_interface') }).Count -gt 0) { return 'Standard' }
    return 'Lite'
}

function Get-TaskSubjectSha256([object]$Contract, [object]$TaskState, [string]$TaskId, [string]$WorkPackage) {
    $writePaths = @((Get-Property $Contract 'write_paths') | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ })
    if ($writePaths.Count -eq 0) { $writePaths = @((Get-Property $Contract 'allowed_paths') | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ }) }
    $entries = @(Get-GovernanceGitChangedEntries -ProjectRoot $script:root -BaseCommit ([string](Get-Property $TaskState 'start_git_commit')) | Where-Object {
        $candidatePath = ([string](Get-Property $_ 'path')).Replace('\', '/').Trim('/')
        $candidateOldPath = ([string](Get-Property $_ 'old_path')).Replace('\', '/').Trim('/')
        $inScope = @($writePaths | Where-Object { Test-PathWithinScope $candidatePath ([string]$_) -or ($candidateOldPath -and (Test-PathWithinScope $candidateOldPath ([string]$_)) ) }).Count -gt 0
        $substantive = -not (Test-ReviewSystemPath $candidatePath $WorkPackage) -or ($candidateOldPath -and -not (Test-ReviewSystemPath $candidateOldPath $WorkPackage))
        $inScope -and $substantive
    })
    if ($entries.Count -eq 0) { throw "Task $TaskId has no substantive Git changes to fingerprint." }
    return Get-GovernanceGitEntriesSha256 -ProjectRoot $script:root -Entries $entries
}

function Get-PropertyPreserveArray([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    # Schema type checks must distinguish [], [x], and x. PowerShell normally
    # unwraps the first two when values cross a function boundary.
    return ,$property.Value
}

function Test-HasProperty([object]$Object, [string]$Name) {
    return $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]
}

function Get-SchemaReference([object]$SchemaRoot, [string]$Reference) {
    if (-not $Reference.StartsWith("#/")) { return $null }
    $node = $SchemaRoot
    foreach ($segment in ($Reference.Substring(2) -split "/")) {
        $name = $segment.Replace("~1", "/").Replace("~0", "~")
        if (-not (Test-HasProperty $node $name)) { return $null }
        $node = Get-Property $node $name
    }
    return $node
}

function Test-JsonSchemaCondition([AllowNull()][object]$Value, [object]$Schema) {
    if ($null -eq $Schema) { return $true }
    foreach ($name in @((Get-Property $Schema "required"))) {
        if (-not (Test-HasProperty $Value ([string]$name))) { return $false }
    }
    if (Test-HasProperty $Schema "const") {
        if (($Value | ConvertTo-Json -Compress -Depth 50) -ne ((Get-Property $Schema "const") | ConvertTo-Json -Compress -Depth 50)) { return $false }
    }
    $properties = Get-Property $Schema "properties"
    if ($properties) {
        foreach ($property in $properties.PSObject.Properties) {
            if ((Test-HasProperty $Value $property.Name) -and -not (Test-JsonSchemaCondition (Get-PropertyPreserveArray $Value $property.Name) $property.Value)) { return $false }
        }
    }
    return $true
}

function Test-JsonSchemaValue {
    param(
        [AllowNull()][object]$Value,
        [Parameter(Mandatory = $true)][object]$Schema,
        [Parameter(Mandatory = $true)][object]$SchemaRoot,
        [Parameter(Mandatory = $true)][string]$JsonPath,
        [string]$DocumentName = "governance.json"
    )

    $reference = Get-Property $Schema '$ref'
    if ($reference) {
        $resolved = Get-SchemaReference $SchemaRoot ([string]$reference)
        if ($null -eq $resolved) { Add-Error "JSON Schema 引用无法解析：$reference ($JsonPath)"; return }
        Test-JsonSchemaValue -Value $Value -Schema $resolved -SchemaRoot $SchemaRoot -JsonPath $JsonPath -DocumentName $DocumentName
        return
    }

    $allOf = Get-Property $Schema "allOf"
    foreach ($subschema in @($allOf | Where-Object { $null -ne $_ })) {
        $condition = Get-Property $subschema "if"
        if ($condition) {
            $selected = if (Test-JsonSchemaCondition $Value $condition) { Get-Property $subschema "then" } else { Get-Property $subschema "else" }
            if ($selected) { Test-JsonSchemaValue -Value $Value -Schema $selected -SchemaRoot $SchemaRoot -JsonPath $JsonPath -DocumentName $DocumentName }
        } else {
            Test-JsonSchemaValue -Value $Value -Schema $subschema -SchemaRoot $SchemaRoot -JsonPath $JsonPath -DocumentName $DocumentName
        }
    }

    $expectedType = Get-Property $Schema "type"
    $isJsonString = $Value -is [string] -or $Value -is [DateTime] -or $Value -is [DateTimeOffset]
    $stringValue = if ($Value -is [DateTime] -or $Value -is [DateTimeOffset]) { $Value.ToString("o", [Globalization.CultureInfo]::InvariantCulture) } else { [string]$Value }
    $isIntegerValue = $Value -is [sbyte] -or $Value -is [byte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64]
    $isNumericValue = $isIntegerValue -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]
    if ($expectedType) {
        $isArray = $Value -is [System.Array]
        $isObject = $null -ne $Value -and $Value -isnot [string] -and -not $isArray -and $Value -isnot [bool] -and $Value -isnot [ValueType]
        $validType = switch ([string]$expectedType) {
            "object" { $isObject }
            "array" { $isArray }
            "string" { $isJsonString }
            "boolean" { $Value -is [bool] }
            "integer" { $isIntegerValue }
            "number" { $isNumericValue }
            "null" { $null -eq $Value }
            default { Add-Error "JSON Schema 使用了校验器不支持的 type '$expectedType'：$JsonPath"; $false }
        }
        if (-not $validType) { Add-Error "$DocumentName 字段类型无效：$JsonPath（应为 $expectedType）"; return }
    }

    if (Test-HasProperty $Schema "const") {
        $constant = Get-Property $Schema "const"
        if (($Value | ConvertTo-Json -Compress -Depth 50) -ne ($constant | ConvertTo-Json -Compress -Depth 50)) {
            Add-Error "$DocumentName 字段值无效：$JsonPath（必须为 '$constant'）"
        }
    }
    $enum = Get-Property $Schema "enum"
    if ($null -ne $enum) {
        $serialized = $Value | ConvertTo-Json -Compress -Depth 50
        $matchesEnum = @($enum | Where-Object { ($_ | ConvertTo-Json -Compress -Depth 50) -eq $serialized }).Count -gt 0
        if (-not $matchesEnum) { Add-Error "$DocumentName 字段值不在允许范围内：$JsonPath" }
    }

    if ($isNumericValue) {
        $minimum = Get-Property $Schema "minimum"
        $maximum = Get-Property $Schema "maximum"
        if ($null -ne $minimum -and [decimal]$Value -lt [decimal]$minimum) { Add-Error "$DocumentName 字段小于 minimum：$JsonPath（最小值为 $minimum）" }
        if ($null -ne $maximum -and [decimal]$Value -gt [decimal]$maximum) { Add-Error "$DocumentName 字段大于 maximum：$JsonPath（最大值为 $maximum）" }
    }

    if ($isJsonString) {
        $minimumLength = Get-Property $Schema "minLength"
        if ($null -ne $minimumLength -and $stringValue.Length -lt [int]$minimumLength) { Add-Error "$DocumentName 字段过短：$JsonPath" }
        $pattern = Get-Property $Schema "pattern"
        if ($pattern -and $stringValue -notmatch [string]$pattern) { Add-Error "$DocumentName 字段格式无效：$JsonPath" }
        $format = Get-Property $Schema "format"
        if ($format -eq "date") {
            $parsedDate = [DateTime]::MinValue
            if (-not [DateTime]::TryParseExact($stringValue, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedDate)) {
                Add-Error "$DocumentName 日期格式无效：$JsonPath"
            }
        } elseif ($format -and $format -ne "date") {
            Add-Error "JSON Schema 使用了校验器不支持的 format '$format'：$JsonPath"
        }
    }

    if ($Value -is [System.Array]) {
        $minimumItems = Get-Property $Schema "minItems"
        $maximumItems = Get-Property $Schema "maxItems"
        if ($null -ne $minimumItems -and $Value.Count -lt [int]$minimumItems) { Add-Error "$DocumentName 数组元素不足：$JsonPath" }
        if ($null -ne $maximumItems -and $Value.Count -gt [int]$maximumItems) { Add-Error "$DocumentName 数组元素过多：$JsonPath" }
        if ((Get-Property $Schema "uniqueItems") -eq $true) {
            $keys = @($Value | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 50 })
            if (@($keys | Select-Object -Unique).Count -ne $keys.Count) { Add-Error "$DocumentName 数组包含重复元素：$JsonPath" }
        }
        $itemSchema = Get-Property $Schema "items"
        if ($itemSchema) {
            for ($index = 0; $index -lt $Value.Count; $index++) {
                Test-JsonSchemaValue -Value $Value[$index] -Schema $itemSchema -SchemaRoot $SchemaRoot -JsonPath "$JsonPath[$index]" -DocumentName $DocumentName
            }
        }
    }

    $isValueObject = $null -ne $Value -and $Value -isnot [string] -and $Value -isnot [System.Array] -and $Value -isnot [bool] -and $Value -isnot [ValueType]
    if ($isValueObject) {
        $required = Get-Property $Schema "required"
        foreach ($name in @($required)) {
            if (-not (Test-HasProperty $Value ([string]$name))) { Add-Error "$DocumentName 缺少字段：$JsonPath.$name" }
        }
        $properties = Get-Property $Schema "properties"
        if ($properties) {
            foreach ($property in $properties.PSObject.Properties) {
                if (Test-HasProperty $Value $property.Name) {
                    Test-JsonSchemaValue -Value (Get-PropertyPreserveArray $Value $property.Name) -Schema $property.Value -SchemaRoot $SchemaRoot -JsonPath "$JsonPath.$($property.Name)" -DocumentName $DocumentName
                }
            }
        }
        if ((Get-Property $Schema "additionalProperties") -eq $false) {
            $allowed = if ($properties) { @($properties.PSObject.Properties.Name) } else { @() }
            foreach ($property in $Value.PSObject.Properties) {
                if ($property.Name -notin $allowed) { Add-Error "$DocumentName 包含未允许字段：$JsonPath.$($property.Name)" }
            }
        }
    }
}

function Get-MarkdownRows([string]$Content) {
    $rows = @()
    foreach ($line in ($Content -split "\r?\n")) {
        if ($line -notmatch '^\s*\|(.+)\|\s*$') { continue }
        $cells = @($Matches[1] -split '\|' | ForEach-Object { $_.Trim() })
        if (($cells | Where-Object { $_ -and $_ -notmatch '^:?-{3,}:?$' }).Count -eq 0) { continue }
        $rows += ,$cells
    }
    return $rows
}

function Resolve-ProjectPath([string]$RelativePath) {
    $clean = $RelativePath.Trim().Trim('`').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    if ([System.IO.Path]::IsPathRooted($clean)) { return $null }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $script:root $clean))
    if (-not ($candidate.Equals($script:root, $script:pathComparison) -or $candidate.StartsWith($script:root + [System.IO.Path]::DirectorySeparatorChar, $script:pathComparison))) { return $null }
    return $candidate
}

function Test-ProjectPathContainsLink([string]$RelativePath) {
    $current = $script:root
    foreach ($segment in @($RelativePath.Replace('\', '/').Trim('/') -split '/')) {
        if (-not $segment) { continue }
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) { return $false }
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
    }
    return $false
}

function Test-TaskApprovalBinding([string]$Block, [string]$Type, [string]$TaskId, [string]$PlanHash, [string]$Baseline, [string]$SubjectSha256 = '', [string]$EvidenceSha256 = '') {
    if ($Block -notmatch '(?m)^\s*status:\s*approved\s*$' -or
        $Block -notmatch "(?m)^\s*approval_type:\s*$([regex]::Escape($Type))\s*$" -or
        $Block -notmatch "(?m)^\s*-\s*$([regex]::Escape($TaskId))\s*$" -or
        $Block -notmatch "(?m)^\s*plan_sha256:\s*$([regex]::Escape($PlanHash))\s*$" -or
        $Block -notmatch '(?m)^\s*confirmation_id:\s*CONF-[A-Za-z0-9][A-Za-z0-9._:-]{5,127}\s*$' -or
        $Block -notmatch "(?m)^\s*baseline:\s*$([regex]::Escape($Baseline))\s*$") { return $false }
    if ($Type -eq 'acceptance' -and ($SubjectSha256 -notmatch '^[0-9a-f]{64}$' -or $EvidenceSha256 -notmatch '^[0-9a-f]{64}$' -or $Block -notmatch "(?m)^\s*subject_sha256:\s*$([regex]::Escape($SubjectSha256))\s*$" -or $Block -notmatch "(?m)^\s*evidence_sha256:\s*$([regex]::Escape($EvidenceSha256))\s*$")) { return $false }
    $expiresMatch = [regex]::Match($Block, '(?m)^\s*expires_at:\s*(.*?)\s*$')
    if (-not $expiresMatch.Success) { return $false }
    $expiresValue = $expiresMatch.Groups[1].Value.Trim()
    if ($expiresValue -in @('null', '~', '')) { return $true }
    $expiresAt = [DateTimeOffset]::MinValue
    return [DateTimeOffset]::TryParse($expiresValue, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$expiresAt) -and $expiresAt -gt [DateTimeOffset]::UtcNow
}

function Test-OperationalDocument([string]$RelativePath) {
    if ($RelativePath -like "docs/00-index/*" -or $RelativePath -like "docs/08-changes/*" -or $RelativePath -like "docs/09-reports/*") { return $true }
    return $RelativePath -in @(
        "docs/04-delivery/WORK-STATUS.md",
        "docs/04-delivery/TASK-LEDGER.md",
        "docs/05-quality/traceability.md"
    )
}

if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Project path does not exist: $root" }

@(
    "AGENTS.md", "docs/00-index/PROJECT.md", "docs/00-index/CURRENT-STATE.md",
    "docs/00-index/DECISION-QUEUE.md", "docs/00-index/DOC-REGISTRY.md",
    "docs/01-governance/charter.md", "docs/02-product/requirements.md",
    "docs/03-architecture/overall-design.md", "docs/04-delivery/WORK-PACKAGES.md",
    "docs/04-delivery/WORK-STATUS.md",
    "docs/05-quality/traceability.md", "schemas/work-package-context.schema.json",
    "schemas/governed-work.schema.json", "schemas/governed-work-state.schema.json",
    "schemas/validation-evidence.schema.json"
) | ForEach-Object { Require-File $_ }

$governancePath = Join-Path $root "governance.json"
$schemaPath = Join-Path $root "schemas/governance.schema.json"
$governance = $null
if (-not (Test-Path -LiteralPath $governancePath -PathType Leaf)) {
    Add-Error "Missing required file: governance.json"
} elseif (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) {
    Add-Error "Missing required file: schemas/governance.schema.json"
} else {
    try { $governance = Read-Utf8 $governancePath | ConvertFrom-Json -ErrorAction Stop }
    catch { Add-Error "governance.json 不是有效 JSON：$($_.Exception.Message)" }
    try { $governanceSchema = Read-Utf8 $schemaPath | ConvertFrom-Json -ErrorAction Stop }
    catch { Add-Error "governance.schema.json 不是有效 JSON Schema：$($_.Exception.Message)"; $governanceSchema = $null }
    if ($null -ne $governance -and $null -ne $governanceSchema) {
        Test-JsonSchemaValue -Value $governance -Schema $governanceSchema -SchemaRoot $governanceSchema -JsonPath '$'
        $frameworkState = Get-Property $governance "framework"
        $sourceDirty = Get-Property $frameworkState "source_dirty"
        $sourceTreeHash = [string](Get-Property $frameworkState "source_tree_hash")
        if ($sourceDirty -eq $true -and $sourceTreeHash -notmatch '^[0-9a-fA-F]{64}$') {
            Add-Error "governance.json 在 framework.source_dirty=true 时必须记录 64 位 source_tree_hash。"
        }
    }
    if ($null -ne $governance -and $levelRank -ge 2) {
        $authoritative = Get-Property $governance "authoritative_documents"
        foreach ($field in @("project", "current_state", "document_registry", "baseline_registry", "approval_log", "charter", "requirements", "overall_design", "work_packages", "work_status", "traceability")) {
            if (-not (Test-HasProperty $authoritative $field)) { continue }
            $relativePath = [string](Get-Property $authoritative $field)
            $resolved = Resolve-ProjectPath $relativePath
            if (-not $resolved -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { Add-Error "governance.json 的权威文档路径不存在或越界：$relativePath" }
        }
        $contextPolicy = Get-Property $governance "context_policy"
        foreach ($profile in @("Lite", "Standard", "Release")) {
            $budget = Get-Property $contextPolicy $profile
            $targetChars = [int](Get-Property $budget "target_chars")
            $warningChars = [int](Get-Property $budget "warning_chars")
            if ($targetChars -le 0) { Add-Error "governance.json 的 $profile 上下文软目标必须大于 0。" }
            if ($warningChars -lt $targetChars) { Add-Error "governance.json 的 $profile 上下文告警阈值不得低于软目标。" }
        }
    }
}

if ($levelRank -ge 2) {
    $frameworkManifestPath = Join-Path $root ".governance/framework-manifest.json"
    $frameworkManifest = $null
    if (-not (Test-Path -LiteralPath $frameworkManifestPath -PathType Leaf)) {
        Add-Error "Strict 校验要求 .governance/framework-manifest.json。"
    } else {
        try { $frameworkManifest = Read-Utf8 $frameworkManifestPath | ConvertFrom-Json -ErrorAction Stop }
        catch { Add-Error "framework-manifest.json 不是有效 JSON：$($_.Exception.Message)" }
    }
    if ($null -ne $frameworkManifest) {
        $frameworkManifestVersion = [int](Get-Property $frameworkManifest "schema_version")
        if ($frameworkManifestVersion -notin @(2, 3)) { Add-Error "framework-manifest.json 的 schema_version 无效。" }
        $managedFiles = Get-Property $frameworkManifest "files"
        if ($null -eq $managedFiles) { Add-Error "framework-manifest.json 缺少 files。" }
        $computedLocalModifications = $false
        if ($null -ne $managedFiles) {
            foreach ($property in $managedFiles.PSObject.Properties) {
                $relativePath = [string]$property.Name
                $expectedHash = [string]$property.Value
                $resolved = Resolve-ProjectPath $relativePath
                if (-not $resolved) {
                    Add-Error "framework-manifest.json 的托管路径越界：$relativePath"
                    $computedLocalModifications = $true
                    continue
                }
                if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') {
                    Add-Error "framework-manifest.json 的托管文件哈希无效：$relativePath"
                    $computedLocalModifications = $true
                    continue
                }
                if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                    Add-Error "框架托管文件缺失：$relativePath"
                    $computedLocalModifications = $true
                    continue
                }
                $actualHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($actualHash -ne $expectedHash.ToLowerInvariant()) {
                    Add-Error "框架托管文件与清单哈希不一致：$relativePath"
                    $computedLocalModifications = $true
                }
            }
        }
        $pendingRemovals = Get-Property $frameworkManifest "pending_removals"
        if ($null -ne $pendingRemovals) {
            foreach ($property in $pendingRemovals.PSObject.Properties) {
                $relativePath = [string]$property.Name
                $expectedHash = [string]$property.Value
                $resolved = Resolve-ProjectPath $relativePath
                if (-not $resolved) {
                    Add-Error "framework-manifest.json 的待移除路径越界：$relativePath"
                    $computedLocalModifications = $true
                    continue
                }
                if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') {
                    Add-Error "framework-manifest.json 的待移除文件哈希无效：$relativePath"
                    $computedLocalModifications = $true
                    continue
                }
                if (Test-Path -LiteralPath $resolved -PathType Leaf) {
                    Add-Warning "仍保留上游已移除的框架文件：$relativePath"
                    $actualHash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
                    if ($actualHash -ne $expectedHash.ToLowerInvariant()) {
                        Add-Error "待移除框架文件存在本地修改：$relativePath"
                        $computedLocalModifications = $true
                    }
                } else {
                    Add-Warning "待移除框架文件已不存在，请运行升级工具刷新清单：$relativePath"
                }
            }
        }
        if ($null -ne $governance) {
            $frameworkState = Get-Property $governance "framework"
            $declaredLocalModifications = Get-Property $frameworkState "local_modifications"
            if ($declaredLocalModifications -is [bool] -and [bool]$declaredLocalModifications -ne $computedLocalModifications) {
                Add-Error "governance.json 的 framework.local_modifications 与托管文件实际状态不一致。"
            }
            foreach ($mapping in @(
                @("version", "framework_version"),
                @("source_commit", "source_commit"),
                @("source_dirty", "source_dirty"),
                @("source_tree_hash", "source_tree_hash")
            )) {
                $stateValue = Get-Property $frameworkState $mapping[0]
                $manifestValue = Get-Property $frameworkManifest $mapping[1]
                if (($stateValue | ConvertTo-Json -Compress) -ne ($manifestValue | ConvertTo-Json -Compress)) {
                    Add-Error "governance.json 的 framework.$($mapping[0]) 与 framework-manifest.json 不一致。"
                }
            }
        }
    }
}

$docsRoot = Join-Path $root "docs"
$documents = if (Test-Path -LiteralPath $docsRoot -PathType Container) { @(Get-ChildItem -LiteralPath $docsRoot -Recurse -File -Filter "*.md") } else { @() }
$docIds = @{}
$docRecords = @()
$activeTypes = @{}
$today = [DateTime]::Today
$documentStatuses = @("draft", "proposed", "active", "superseded", "retired", "archived")
$decisionStatuses = @("proposed", "approved", "rejected", "superseded", "retired")
$changeStatuses = @("proposed", "approved", "implemented", "verified", "accepted", "rejected", "superseded", "retired")
$placeholderPattern = '(?i)\{\{[^}]+\}\}|\bTBD\b|\bTODO\b|\bTo be defined\b|\bTo be agreed\b|待确认|待定义|待填写|待补充|待关联|未分配'

foreach ($file in $documents) {
    $relative = Get-RelativePath $file.FullName
    $content = Read-Utf8 $file.FullName
    $isTemplate = $file.Name -match '(?i)README|TEMPLATE'
    $meta = Get-FrontMatter $content
    if ($null -eq $meta) {
        if (-not $isTemplate) { Add-Warning "缺少元数据头：$relative" }
        continue
    }
    foreach ($required in @("doc_id", "type", "status", "version", "owner", "baseline", "last_reviewed")) {
        if (-not $meta.ContainsKey($required) -or [string]::IsNullOrWhiteSpace([string]$meta[$required])) { Add-Error "缺少元数据 '$required'：$relative" }
    }
    $id = [string]$meta.doc_id
    if ($id -and $id -notin @("DEC-NNN", "CR-NNN")) {
        if ($docIds.ContainsKey($id)) { Add-Error "重复的 doc_id '$id'：$($docIds[$id].RelativePath) 和 $relative" }
        else {
            $record = [pscustomobject]@{ Id=$id; RelativePath=$relative; FullName=$file.FullName; Meta=$meta; Content=$content }
            $docIds[$id] = $record
            $docRecords += $record
        }
    }
    $allowedStatuses = if ($meta.type -eq "decision") { $decisionStatuses } elseif ($meta.type -eq "change-package") { $changeStatuses } else { $documentStatuses }
    if ($meta.status -and $meta.status -notin $allowedStatuses) { Add-Error "status 值无效 '$($meta.status)'：$relative" }
    if ($meta.status -eq "active" -and $meta.type) {
        if ($activeTypes.ContainsKey([string]$meta.type)) { Add-Error "同一 type 存在多个 active 文档 '$($meta.type)'：$($activeTypes[[string]$meta.type]) 和 $relative" }
        else { $activeTypes[[string]$meta.type] = $relative }
    }
    if ($meta.last_reviewed -match '^\d{4}-\d{2}-\d{2}$') {
        try { $reviewDate = [DateTime]::ParseExact([string]$meta.last_reviewed, "yyyy-MM-dd", $null) }
        catch { Add-Error "last_reviewed 日期无效：$relative"; $reviewDate = $today }
        if (($today - $reviewDate).TotalDays -gt 90 -and $meta.status -eq "active") { Add-Warning "有效文档超过 90 天未复审：$relative" }
    } else { Add-Error "last_reviewed 日期格式无效：$relative" }
    if (-not $isTemplate -and $meta.status -in @("active", "approved", "implemented", "verified", "accepted") -and $content -match $placeholderPattern) { Add-Warning "有效文档仍包含占位内容：$relative" }
}

if ($levelRank -ge 2) {
    foreach ($record in $docRecords) {
        foreach ($field in @("depends_on", "affects")) {
            foreach ($reference in @($record.Meta[$field])) {
                if ($reference -and -not $docIds.ContainsKey([string]$reference)) { Add-Error "无效的 $field 引用 '$reference'：$($record.RelativePath)" }
            }
        }
    }
}

$registryPath = Join-Path $root "docs/00-index/DOC-REGISTRY.md"
$registryEntries = @{}
if (Test-Path -LiteralPath $registryPath -PathType Leaf) {
    $registryContent = Read-Utf8 $registryPath
    foreach ($cells in (Get-MarkdownRows $registryContent)) {
        if ($cells.Count -lt 7 -or $cells[0] -in @("文档编号", "Document ID")) { continue }
        $id = $cells[0]
        if ($id -notmatch '^[A-Z][A-Z0-9-]+$') { continue }
        $registryEntries[$id] = $cells
        if ($levelRank -ge 2) {
            $resolved = Resolve-ProjectPath $cells[1]
            if (-not $resolved -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) { Add-Error "DOC-REGISTRY.md 路径不存在或越界：$($cells[1])"; continue }
            $registeredContent = Read-Utf8 $resolved
            $registeredMeta = Get-FrontMatter $registeredContent
            if ($null -eq $registeredMeta) { Add-Error "注册文档缺少元数据：$($cells[1])"; continue }
            $comparisons = @{ doc_id=0; type=2; status=3; version=4; baseline=5; owner=6 }
            foreach ($key in $comparisons.Keys) {
                if ([string]$registeredMeta[$key] -ne [string]$cells[$comparisons[$key]]) { Add-Error "DOC-REGISTRY.md 的 $key 与文档不一致：$id" }
            }
        }
    }
    foreach ($id in $docIds.Keys) {
        if (-not $registryEntries.ContainsKey($id)) { Add-Warning "文档未登记到 DOC-REGISTRY.md：$id" }
    }
}

$statePath = Join-Path $root "docs/00-index/CURRENT-STATE.md"
$currentBaseline = $null
$currentPhase = $null
$currentMode = $null
$currentValidationLevel = $null
$currentTaskProfile = $null
if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    $state = Read-Utf8 $statePath
    if ($state -match '(?im)(?:Current baseline|当前基线)\s*[：:]\s*(BL-\d+)') { $currentBaseline = $Matches[1] }
    else { Add-Error "CURRENT-STATE.md 未声明当前基线。" }
    if ($state -match '(?im)(?:Current phase|当前阶段)\s*[：:]\s*`?([A-Za-z][A-Za-z0-9_-]*)`?') { $currentPhase = $Matches[1].Replace("-", "_").ToUpperInvariant() }
    else { Add-Error "CURRENT-STATE.md 未声明当前阶段。" }
    if ($state -match '(?im)(?:Operating mode|运行模式)\s*[：:]\s*`?([A-Za-z][A-Za-z0-9_-]*)`?') { $currentMode = $Matches[1].Replace("-", "_").ToUpperInvariant() }
    else { Add-Error "CURRENT-STATE.md 未声明运行模式。" }
    if ($state -match '(?im)(?:Governance validation level|治理检查级别)\s*[：:]\s*`?(Basic|Strict|Release)`?') { $currentValidationLevel = $Matches[1] }
    else { Add-Error "CURRENT-STATE.md 未声明治理检查级别。" }
    if ($state -match '(?im)(?:Default task profile|默认任务档位)\s*[：:]\s*`?(Lite|Standard|Release)`?') { $currentTaskProfile = $Matches[1] }
    else { Add-Error "CURRENT-STATE.md 未声明默认任务档位。" }
}
$teamLedgerTasks = $null
if ($null -ne $governance) {
    $governanceBaseline = [string](Get-Property $governance "current_baseline")
    $governanceProject = Get-Property $governance "project"
    $governancePhase = [string](Get-Property $governanceProject "phase")
    $governanceMode = [string](Get-Property $governanceProject "mode")
    $governanceValidationLevel = [string](Get-Property $governance "validation_level")
    $governanceTaskProfile = [string](Get-Property $governance "task_profile")
    if ($governanceBaseline) {
        if ($currentBaseline -and $currentBaseline -ne $governanceBaseline) { Add-Error "CURRENT-STATE.md 与 governance.json 的当前基线不一致。" }
        $currentBaseline = $governanceBaseline
    }
    if ($currentPhase -and $governancePhase -and $currentPhase -ne $governancePhase.ToUpperInvariant()) { Add-Error "CURRENT-STATE.md 与 governance.json 的当前阶段不一致。" }
    if ($currentMode -and $governanceMode -and $currentMode -ne $governanceMode.ToUpperInvariant()) { Add-Error "CURRENT-STATE.md 与 governance.json 的运行模式不一致。" }
    if ($currentValidationLevel -and $governanceValidationLevel -and $currentValidationLevel -ne $governanceValidationLevel) { Add-Error "CURRENT-STATE.md 与 governance.json 的治理检查级别不一致。" }
    if ($currentTaskProfile -and $governanceTaskProfile -and $currentTaskProfile -ne $governanceTaskProfile) { Add-Error "CURRENT-STATE.md 与 governance.json 的默认任务档位不一致。" }
    if ($governanceMode -eq "TEAM_PROJECT") {
        Require-File "docs/04-delivery/TASK-LEDGER.md"
        $ledgerPath = Join-Path $root "docs/04-delivery/TASK-LEDGER.md"
        if (Test-Path -LiteralPath $ledgerPath -PathType Leaf) {
            $ledgerContent = Read-Utf8 $ledgerPath
            $ledgerMeta = Get-FrontMatter $ledgerContent
            foreach ($field in @("project_mode", "ledger_status", "project_manager_task_id", "project_manager_host_id", "review_policy")) {
                if ($null -eq $ledgerMeta -or -not $ledgerMeta.ContainsKey($field) -or [string]::IsNullOrWhiteSpace([string]$ledgerMeta[$field])) { Add-Error "TEAM_PROJECT 任务台账缺少元数据 '$field'。" }
            }
            if ($null -ne $ledgerMeta) {
                if ([string]$ledgerMeta.project_mode -ne "TEAM_PROJECT") { Add-Error "TEAM_PROJECT 任务台账的 project_mode 必须为 TEAM_PROJECT。" }
                if ([string]$ledgerMeta.ledger_status -ne "active") { Add-Error "TEAM_PROJECT 任务台账的 ledger_status 必须为 active。" }
                if ([string]$ledgerMeta.review_policy -ne "independent-required") { Add-Error "TEAM_PROJECT 任务台账的 review_policy 必须为 independent-required。" }
                foreach ($field in @("project_manager_task_id", "project_manager_host_id")) {
                    if ([string]$ledgerMeta[$field] -match '^(?i:none|null|pending|unknown)$') { Add-Error "TEAM_PROJECT 任务台账的 $field 必须记录真实标识。" }
                }
            }
            $ledgerRows = @(Get-MarkdownRows $ledgerContent)
            $expectedHeaders = @("工作包", "独立任务标识", "宿主标识", "任务角色", "任务标题", "基线", "环境/分支", "依赖", "状态", "交付物", "验证", "审核任务", "审核状态", "审核证据", "最近进展")
            $ledgerHeaders = @($ledgerRows | Where-Object { $_.Count -ge $expectedHeaders.Count -and (@(Compare-Object -ReferenceObject $expectedHeaders -DifferenceObject @($_[0..($expectedHeaders.Count - 1)]) -SyncWindow 0).Count -eq 0) })
            if ($ledgerHeaders.Count -eq 0) {
                Add-Error "TEAM_PROJECT 任务台账缺少包含独立审核字段的标准表头。"
            } else {
                $allowedRoles = @("ANALYST", "ARCHITECT", "IMPLEMENTER", "TESTER", "INTEGRATOR", "REVIEWER")
                $allowedTaskStates = @("pending", "running", "needs-attention", "completed", "replaced", "archived")
                $allowedReviewStates = @("pending", "running", "changes-required", "provisional-passed", "passed", "cancelled")
                $ledgerTasks = @{}
                foreach ($cells in @($ledgerRows | Where-Object { $_.Count -ge $expectedHeaders.Count -and $_[1] -match '^TASK-\d{3,}$' })) {
                    $taskId = [string]$cells[1]
                    if ($ledgerTasks.ContainsKey($taskId)) { Add-Error "TEAM_PROJECT 任务台账包含重复独立任务标识：$taskId"; continue }
                    $ledgerTasks[$taskId] = [pscustomobject]@{
                        WorkPackage=[string]$cells[0]; TaskId=$taskId; Host=[string]$cells[2]; Role=([string]$cells[3]).ToUpperInvariant()
                        Baseline=[string]$cells[5]; Dependencies=[string]$cells[7]; State=([string]$cells[8]).ToLowerInvariant()
                        ReviewTask=([string]$cells[11]).Trim('`'); ReviewState=([string]$cells[12]).ToLowerInvariant(); ReviewEvidence=([string]$cells[13]).Trim('`')
                    }
                }
                foreach ($task in $ledgerTasks.Values) {
                    if ($task.Role -notin $allowedRoles) { Add-Error "TEAM_PROJECT 任务台账的任务角色无效：$($task.TaskId) -> $($task.Role)" }
                    if ($task.State -notin $allowedTaskStates) { Add-Error "TEAM_PROJECT 任务台账的任务状态无效：$($task.TaskId) -> $($task.State)" }
                    if ($task.Role -eq 'REVIEWER') {
                        foreach ($value in @($task.ReviewTask, $task.ReviewState, $task.ReviewEvidence)) {
                            if ($value -notmatch '^(?i:n/?a|-)$') { Add-Error "独立审核任务不递归绑定审核任务，审核字段必须填写 n/a：$($task.TaskId)"; break }
                        }
                        continue
                    }
                    if ($task.ReviewState -notin $allowedReviewStates) { Add-Error "TEAM_PROJECT 交付任务的审核状态无效：$($task.TaskId) -> $($task.ReviewState)"; continue }
                    if ($task.State -in @('replaced', 'archived') -and $task.ReviewState -eq 'cancelled') {
                        continue
                    }
                    if ($task.ReviewState -eq 'cancelled') { Add-Error "只有 replaced 或 archived 任务可以取消审核：$($task.TaskId)"; continue }
                    if ($task.ReviewTask -notmatch '^TASK-\d{3,}$') { Add-Error "TEAM_PROJECT 交付任务必须绑定独立审核任务：$($task.TaskId)"; continue }
                    if (-not $ledgerTasks.ContainsKey($task.ReviewTask)) { Add-Error "TEAM_PROJECT 交付任务引用的审核任务不存在：$($task.TaskId) -> $($task.ReviewTask)"; continue }
                    $reviewer = $ledgerTasks[$task.ReviewTask]
                    if ($reviewer.TaskId -eq $task.TaskId -or $reviewer.Role -ne 'REVIEWER') { Add-Error "TEAM_PROJECT 交付任务必须由不同的 REVIEWER 任务审核：$($task.TaskId) -> $($task.ReviewTask)" }
                    if ($reviewer.WorkPackage -ne $task.WorkPackage) { Add-Error "审核任务必须与被审核任务属于同一工作包：$($task.TaskId) -> $($reviewer.TaskId)" }
                    if ($reviewer.Dependencies -notmatch "(?<![A-Za-z0-9-])$([regex]::Escape($task.TaskId))(?![A-Za-z0-9-])") { Add-Error "审核任务必须依赖被审核任务：$($reviewer.TaskId) -> $($task.TaskId)" }
                    if ($task.State -eq 'completed' -and $task.ReviewState -ne 'passed' -and -not $AllowLegacyTaskStates) { Add-Error "TEAM_PROJECT 交付任务完成前必须通过独立审核：$($task.TaskId)" }
                    if ($task.ReviewState -eq 'passed') {
                        if ($reviewer.State -ne 'completed') { Add-Error "审核结论为 passed 时审核任务必须 completed：$($task.TaskId) -> $($reviewer.TaskId)" }
                        $expectedEvidencePrefix = "docs/05-quality/evidence/$($reviewer.TaskId)/"
                        $reviewEvidenceValues = @($task.ReviewEvidence -split '\s*,\s*' | ForEach-Object { ([string]$_).Trim().Trim('`') } | Where-Object { $_ })
                        if ($reviewEvidenceValues.Count -eq 0) { Add-Error "审核通过任务缺少审核证据路径：$($task.TaskId)" }
                        $matchingEvidenceCount = 0
                        foreach ($reviewEvidenceValue in $reviewEvidenceValues) {
                            if (-not $reviewEvidenceValue.StartsWith($expectedEvidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { Add-Error "审核证据必须位于审核任务自己的证据目录：$($task.TaskId) -> $reviewEvidenceValue"; continue }
                            $reviewEvidencePath = Resolve-ProjectPath $reviewEvidenceValue
                            if (-not $reviewEvidencePath -or -not (Test-Path -LiteralPath $reviewEvidencePath -PathType Leaf)) {
                                Add-Error "审核证据不存在或越界：$($task.TaskId) -> $reviewEvidenceValue"
                            } else {
                                try { $reviewDocument = Read-Utf8 $reviewEvidencePath | ConvertFrom-Json -ErrorAction Stop }
                                catch { Add-Error "审核证据不是有效 JSON：$($task.TaskId) -> $reviewEvidenceValue"; $reviewDocument = $null }
                                if ($null -ne $reviewDocument) {
                                    if ([string](Get-Property $reviewDocument '$schema') -ne 'schemas/review-evidence.schema.json' -or [string](Get-Property $reviewDocument 'reviewer_task_id') -ne $reviewer.TaskId -or [string](Get-Property $reviewDocument 'result') -ne 'passed' -or [string](Get-Property $reviewDocument 'work_package') -ne $task.WorkPackage -or [string](Get-Property $reviewDocument 'baseline') -ne $task.Baseline -or [string]::IsNullOrWhiteSpace([string](Get-Property $reviewDocument 'change_summary')) -or -not [bool](Get-Property $reviewDocument 'diff_checked')) {
                                        Add-Error "审核通过证据必须绑定审核任务、工作包、基线，并声明 diff_checked=true：$($task.TaskId)"
                                    }
                                    $taskChanges = @((Get-Property $reviewDocument 'changes') | Where-Object { [string](Get-Property $_ 'task_id') -eq $task.TaskId })
                                    if ($taskChanges.Count -gt 0 -and $task.TaskId -in @((Get-Property $reviewDocument 'reviewed_task_ids'))) { $matchingEvidenceCount++ }
                                    else { Add-Error "审核通过证据必须列出被审核任务的实际变更内容，不能只有自动化测试 pass：$($task.TaskId)" }
                                    $meaningfulChanges = @($taskChanges | Where-Object { ([string](Get-Property $_ 'path')).Replace('\', '/') -notmatch '^(?:\.governance/|docs/05-quality/evidence/)' })
                                    if ($taskChanges.Count -gt 0 -and $meaningfulChanges.Count -eq 0) { Add-Error "审核通过证据只列出了治理或自动化证据文件，缺少实际项目内容变更：$($task.TaskId)" }
                                }
                            }
                        }
                        if ($matchingEvidenceCount -eq 0) { Add-Error "没有审核证据完整绑定被审核任务：$($task.TaskId)" }
                    }
                }
                $teamLedgerTasks = $ledgerTasks
            }
        }
    }
}
$currentManifestRouteIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$currentManifestLoaded = $false
$baselineRegistryPath = Join-Path $root "docs/00-index/BASELINE-REGISTRY.md"
if (Test-Path -LiteralPath $baselineRegistryPath -PathType Leaf) {
    $baselineRows = @()
    foreach ($cells in (Get-MarkdownRows (Read-Utf8 $baselineRegistryPath))) {
        if ($cells.Count -ge 7 -and $cells[0] -match '^BL-\d{3,}$') {
            $baselineRows += ,[pscustomobject]@{ Id=$cells[0]; Status=$cells[1].ToLowerInvariant(); Manifest=$cells[2].Trim('`'); Commit=$cells[3]; Approval=$cells[4]; Date=$cells[5] }
        }
    }
    $activeBaselines = @($baselineRows | Where-Object Status -eq "active")
    if ($levelRank -ge 2) {
        if ($activeBaselines.Count -ne 1) { Add-Error "BASELINE-REGISTRY.md 必须恰好存在一个 active 基线，当前为 $($activeBaselines.Count) 个。" }
        elseif ($currentBaseline -and $activeBaselines[0].Id -ne $currentBaseline) { Add-Error "BASELINE-REGISTRY.md 的 active 基线与 governance.json 不一致。" }
    }
    $currentBaselineRows = @($baselineRows | Where-Object Id -eq $currentBaseline)
    if ($currentBaseline -and $currentBaselineRows.Count -ne 1) { Add-Error "BASELINE-REGISTRY.md 必须恰好登记一次当前基线 $currentBaseline。" }
    if ($levelRank -ge 2 -and $currentBaselineRows.Count -eq 1) {
        $baselineRow = $currentBaselineRows[0]
        if ($baselineRow.Status -ne "active") { Add-Error "当前基线 $currentBaseline 尚未处于 active 状态。" }
        if ($baselineRow.Manifest -notmatch '(?i)^baselines[/\\][^/\\]+[/\\]manifest\.json$') { Add-Error "当前基线清单必须使用 manifest.json：$($baselineRow.Manifest)" }
        $manifestPath = Resolve-ProjectPath $baselineRow.Manifest
        if (-not $manifestPath -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            Add-Error "当前基线清单不存在或越界：$($baselineRow.Manifest)"
        } else {
            try { $manifest = Read-Utf8 $manifestPath | ConvertFrom-Json -ErrorAction Stop }
            catch { Add-Error "当前基线清单不是有效 JSON：$($baselineRow.Manifest)"; $manifest = $null }
            if ($null -ne $manifest) {
                $currentManifestLoaded = $true
                $manifestSchemaVersion = [int](Get-Property $manifest "schema_version")
                if ($manifestSchemaVersion -notin @(1, 2)) { Add-Error "基线清单 schema_version 无效。" }
                if ($manifestSchemaVersion -eq 2 -and [int](Get-Property $manifest "scope_version") -ne 1) { Add-Error "基线清单 scope_version 无效。" }
                if ([string](Get-Property $manifest "baseline") -ne $currentBaseline) { Add-Error "基线清单中的 baseline 与当前基线不一致。" }
                $manifestCreatedAt = [DateTimeOffset]::MinValue
                if (-not [DateTimeOffset]::TryParse([string](Get-Property $manifest "created_at"), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$manifestCreatedAt)) { Add-Error "基线清单 created_at 格式无效。" }
                $manifestApproval = [string](Get-Property $manifest "approval_id")
                if ($baselineRow.Approval -notmatch '^APR-\d{3,}$') { Add-Error "active 基线必须具备 APR 批准记录。" }
                if ($manifestApproval -notin @("pending", $baselineRow.Approval)) { Add-Error "基线清单中的 approval_id 与注册表不一致。" }
                $activationPath = Join-Path (Split-Path -Parent $manifestPath) "activation.json"
                if (-not (Test-Path -LiteralPath $activationPath -PathType Leaf)) {
                    Add-Error "active 基线缺少不可变激活证据 activation.json。"
                } else {
                    try { $activation = Read-Utf8 $activationPath | ConvertFrom-Json -ErrorAction Stop }
                    catch { Add-Error "active 基线的 activation.json 不是有效 JSON。"; $activation = $null }
                    if ($null -ne $activation) {
                        if ([int](Get-Property $activation "schema_version") -ne 1) { Add-Error "activation.json 的 schema_version 无效。" }
                        if ([string](Get-Property $activation "baseline") -ne $currentBaseline -or [string](Get-Property $activation "approval_id") -ne $baselineRow.Approval) { Add-Error "activation.json 与当前基线或批准记录不一致。" }
                        $activatedAt = [DateTimeOffset]::MinValue
                        if (-not [DateTimeOffset]::TryParse([string](Get-Property $activation "activated_at"), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$activatedAt)) { Add-Error "activation.json 的 activated_at 格式无效。" }
                        if ([string](Get-Property $activation "previous_baseline") -notmatch '^BL-\d{3,}$') { Add-Error "activation.json 的 previous_baseline 格式无效。" }
                    }
                }
                $manifestCommit = [string](Get-Property $manifest "git_commit")
                if ($manifestCommit -and $manifestCommit -notmatch '^(?:[0-9a-fA-F]{7,40}|unknown)$') { Add-Error "基线清单 git_commit 格式无效。" }
                $manifestDocuments = @(Get-Property $manifest "documents")
                if ($manifestDocuments.Count -eq 0) { Add-Error "基线清单未包含任何文档。" }
                $manifestPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
                foreach ($document in $manifestDocuments) {
                    $documentPath = [string](Get-Property $document "path")
                    $documentHash = [string](Get-Property $document "sha256")
                    if (-not $documentPath -or -not $manifestPaths.Add($documentPath)) { Add-Error "基线清单包含空路径或重复文档路径：$documentPath" }
                    if ($documentHash -notmatch '^[0-9a-fA-F]{64}$') { Add-Error "基线清单文档哈希格式无效：$documentPath" }
                    $resolvedDocument = if ($documentPath) { Resolve-ProjectPath $documentPath } else { $null }
                    if (-not $resolvedDocument -or -not (Test-Path -LiteralPath $resolvedDocument -PathType Leaf)) { Add-Error "基线清单引用的文档不存在或越界：$documentPath" }
                    elseif ($documentHash -match '^[0-9a-fA-F]{64}$') {
                        $actualDocumentHash = (Get-FileHash -LiteralPath $resolvedDocument -Algorithm SHA256).Hash.ToLowerInvariant()
                        if ($actualDocumentHash -ne $documentHash.ToLowerInvariant()) { Add-Error "基线清单文档哈希与实际内容不一致：$documentPath" }
                    }
                    if ($manifestSchemaVersion -eq 2 -and (Test-OperationalDocument -RelativePath $documentPath)) { Add-Error "schema_version=2 基线清单不得包含运行状态文档：$documentPath" }
                }
                $operationalDocuments = @(Get-Property $manifest "operational_documents")
                foreach ($operationalDocument in $operationalDocuments) {
                    $operationalPath = [string](Get-Property $operationalDocument "path")
                    $resolvedOperational = if ($operationalPath) { Resolve-ProjectPath $operationalPath } else { $null }
                    if (-not $resolvedOperational -or -not (Test-Path -LiteralPath $resolvedOperational -PathType Leaf)) { Add-Error "基线清单引用的运行状态文档不存在或越界：$operationalPath" }
                    if ($operationalPath -and -not (Test-OperationalDocument -RelativePath $operationalPath)) { Add-Error "运行状态文档不在允许范围内：$operationalPath" }
                }
                $manifestContextRoutes = @(Get-Property $manifest "context_routes")
                $manifestRoutePaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
                $manifestRoutePackages = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
                foreach ($contextRoute in $manifestContextRoutes) {
                    $routePath = [string](Get-Property $contextRoute "path")
                    $routeHash = [string](Get-Property $contextRoute "sha256")
                    $routeWorkPackage = [string](Get-Property $contextRoute "work_package")
                    $routeBaseline = [string](Get-Property $contextRoute "baseline")
                    if (-not $routePath -or -not $manifestRoutePaths.Add($routePath)) { Add-Error "基线清单包含空路径或重复上下文路由路径：$routePath" }
                    if ($routeWorkPackage -notmatch '^WP-\d{3,}$' -or -not $manifestRoutePackages.Add($routeWorkPackage)) { Add-Error "基线清单包含无效或重复工作包上下文路由：$routeWorkPackage" }
                    elseif ($routeWorkPackage -match '^WP-\d{3,}$') { [void]$currentManifestRouteIds.Add($routeWorkPackage) }
                    if ($routeBaseline -ne $currentBaseline) { Add-Error "基线清单上下文路由的 baseline 与当前基线不一致：$routePath" }
                    if ($routeHash -notmatch '^[0-9a-fA-F]{64}$') { Add-Error "基线清单上下文路由哈希格式无效：$routePath" }
                    $resolvedRoute = if ($routePath) { Resolve-ProjectPath $routePath } else { $null }
                    if (-not $resolvedRoute -or -not (Test-Path -LiteralPath $resolvedRoute -PathType Leaf)) { Add-Error "基线清单引用的上下文路由不存在或越界：$routePath" }
                    else {
                        if ($routeHash -match '^[0-9a-fA-F]{64}$') {
                            $actualRouteHash = (Get-FileHash -LiteralPath $resolvedRoute -Algorithm SHA256).Hash.ToLowerInvariant()
                            if ($actualRouteHash -ne $routeHash.ToLowerInvariant()) { Add-Error "基线清单上下文路由哈希与实际内容不一致：$routePath" }
                        }
                        try { $routeState = Read-Utf8 $resolvedRoute | ConvertFrom-Json -ErrorAction Stop }
                        catch { Add-Error "基线清单引用的上下文路由不是有效 JSON：$routePath"; $routeState = $null }
                        if ($null -ne $routeState -and ([string](Get-Property $routeState "work_package") -ne $routeWorkPackage -or [string](Get-Property $routeState "baseline") -ne $routeBaseline)) {
                            Add-Error "基线清单上下文路由元数据与实际内容不一致：$routePath"
                        }
                    }
                }
            }
        }
        $approvalLogPath = Join-Path $root "docs/00-index/APPROVAL-LOG.md"
        $approvalLog = if (Test-Path -LiteralPath $approvalLogPath -PathType Leaf) { Read-Utf8 $approvalLogPath } else { "" }
        if ($baselineRow.Approval -match '^APR-\d{3,}$') {
            $approvalMatch = [regex]::Match($approvalLog, "(?ms)^\s*approval_id:\s*$([regex]::Escape($baselineRow.Approval))\s*$.*?(?=^\s*approval_id:\s*APR-|\z)")
            if (-not $approvalMatch.Success) { Add-Error "APPROVAL-LOG.md 未登记 active 基线的批准记录 $($baselineRow.Approval)。" }
            else {
                $approvalBlock = $approvalMatch.Value
                if ($approvalBlock -notmatch '(?m)^\s*status:\s*approved\s*$' -or $approvalBlock -notmatch '(?m)^\s*approval_type:\s*baseline\s*$' -or $approvalBlock -notmatch "(?m)^\s*-\s*$([regex]::Escape($currentBaseline))\s*$") {
                    Add-Error "APPROVAL-LOG.md 中 $($baselineRow.Approval) 不是当前基线的有效批准。"
                }
            }
        }
    }
} elseif ($levelRank -ge 2) {
    Add-Error "Missing required file: docs/00-index/BASELINE-REGISTRY.md"
}

$workPath = Join-Path $root "docs/04-delivery/WORK-PACKAGES.md"
if (Test-Path -LiteralPath $workPath -PathType Leaf) {
    $work = Read-Utf8 $workPath
    if ($work -notmatch '(?im)^\|[^|]*WP-\d+[^|]*\|') { Add-Error "WORK-PACKAGES.md 没有工作包行。" }
    if ($work -notmatch '(?i)Acceptance criteria|验收标准') { Add-Error "WORK-PACKAGES.md 缺少验收标准。" }
    if ($work -notmatch '(?i)Required validation|必须执行的验证') { Add-Error "WORK-PACKAGES.md 缺少必须执行的验证要求。" }
}

$workStatusPath = Join-Path $root "docs/04-delivery/WORK-STATUS.md"
if (Test-Path -LiteralPath $workStatusPath -PathType Leaf) {
    $workStatus = Read-Utf8 $workStatusPath
    if ($workStatus -notmatch '(?im)^\|[^|]*WP-\d+[^|]*\|') { Add-Error "WORK-STATUS.md 没有工作包状态行。" }
    if ($levelRank -ge 3) {
        $approvalPath = Join-Path $root "docs/00-index/APPROVAL-LOG.md"
        $approval = if (Test-Path -LiteralPath $approvalPath -PathType Leaf) { Read-Utf8 $approvalPath } else { "" }
        foreach ($cells in (Get-MarkdownRows $workStatus)) {
            if ($cells.Count -lt 5 -or $cells[0] -notmatch '^WP-\d+$') { continue }
            $wp = $cells[0]; $status = $cells[1]; $validation = $cells[4]
            if ($status -in @("verified", "accepted")) {
                $evidenceDir = Join-Path $root "docs/05-quality/evidence"
                $hasEvidenceFile = @(Get-ChildItem -LiteralPath $evidenceDir -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match [regex]::Escape($wp) }).Count -gt 0
                $hasEvidenceReference = $false
                foreach ($pathMatch in [regex]::Matches($validation, '(?i)docs[/\\]05-quality[/\\]evidence[/\\][^\s,;|`]+')) {
                    $candidate = Resolve-ProjectPath $pathMatch.Value
                    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $hasEvidenceReference = $true; break }
                }
                if (-not $hasEvidenceReference -and -not $hasEvidenceFile) { Add-Error "工作包 $wp 状态为 $status，但没有验证证据。" }
            }
            $hasAcceptance = @($approval -split "\r?\n" | Where-Object { $_ -match [regex]::Escape($wp) -and $_ -match '(?i)accepted|批准|接受' }).Count -gt 0
            if ($status -eq "accepted" -and -not $hasAcceptance) {
                Add-Error "工作包 $wp 状态为 accepted，但 APPROVAL-LOG.md 没有接受记录。"
            }
        }
    }
}

if ($levelRank -ge 2) {
    $workPackageIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $workStatusIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $workStatusById = @{}
    if (Test-Path -LiteralPath $workPath -PathType Leaf) {
        foreach ($cells in (Get-MarkdownRows (Read-Utf8 $workPath))) {
            if ($cells.Count -gt 0 -and $cells[0] -match '^WP-\d{3,}$') { [void]$workPackageIds.Add($cells[0]) }
        }
    }
    if (Test-Path -LiteralPath $workStatusPath -PathType Leaf) {
        foreach ($cells in (Get-MarkdownRows (Read-Utf8 $workStatusPath))) {
            if ($cells.Count -gt 1 -and $cells[0] -match '^WP-\d{3,}$' -and $cells[1].ToLowerInvariant() -in @('planned','in-progress','implemented','verified','accepted','blocked','needs-decision','superseded')) {
                [void]$workStatusIds.Add($cells[0])
                $workStatusById[$cells[0]] = $cells[1].ToLowerInvariant()
            }
        }
    }
    $contextRouteIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $contextDirectory = Join-Path $root "docs/04-delivery/context"
    $contextRouteSchemaPath = Join-Path $root "schemas/work-package-context.schema.json"
    $contextRouteSchema = $null
    if (Test-Path -LiteralPath $contextRouteSchemaPath -PathType Leaf) {
        try { $contextRouteSchema = Read-Utf8 $contextRouteSchemaPath | ConvertFrom-Json -ErrorAction Stop }
        catch { Add-Error "work-package-context.schema.json 不是有效 JSON Schema：$($_.Exception.Message)" }
    }
    foreach ($file in @(Get-ChildItem -LiteralPath $contextDirectory -File -Filter "*.context.json" -ErrorAction SilentlyContinue)) {
        if ($file.Name -eq "WP-TEMPLATE.context.json") { continue }
        try { $route = Read-Utf8 $file.FullName | ConvertFrom-Json -ErrorAction Stop }
        catch { Add-Error "工作包上下文路由不是有效 JSON：$(Get-RelativePath $file.FullName)"; continue }
        if ($null -ne $contextRouteSchema) {
            $schemaErrorCount = $errors.Count
            Test-JsonSchemaValue -Value $route -Schema $contextRouteSchema -SchemaRoot $contextRouteSchema -JsonPath '$' -DocumentName "工作包上下文路由 $($file.Name)"
            if ($errors.Count -gt $schemaErrorCount) { continue }
        }
        $routeId = [string](Get-Property $route "work_package")
        if ($routeId -notmatch '^WP-\d{3,}$') { Add-Error "工作包上下文路由的 work_package 无效：$($file.Name)"; continue }
        if ($file.Name -ne "$routeId.context.json") { Add-Error "工作包上下文路由文件名与 work_package 不一致：$($file.Name)" }
        if (-not $contextRouteIds.Add($routeId)) { Add-Error "工作包存在重复上下文路由：$routeId" }
        if ([string](Get-Property $route '$schema') -ne "schemas/work-package-context.schema.json" -or [int](Get-Property $route "schema_version") -ne 1) { Add-Error "工作包上下文路由的 Schema 声明无效：$($file.Name)" }
        if ([string](Get-Property $route "baseline") -notmatch '^BL-\d{3,}$') { Add-Error "工作包上下文路由的 baseline 无效：$routeId" }
        if (-not $workPackageIds.Contains($routeId)) { Add-Error "上下文路由引用了未定义的工作包：$routeId" }
        if (-not $workStatusIds.Contains($routeId)) { Add-Error "上下文路由引用了没有运行状态的工作包：$routeId" }
        $scope = @(Get-Property $route "scope")
        $validation = @(Get-Property $route "validation")
        $requiredDocuments = @(Get-Property $route "required_documents")
        if ($scope.Count -eq 0 -or @($scope | Where-Object { [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) { Add-Error "工作包上下文路由缺少有效 scope：$routeId" }
        if ($validation.Count -eq 0 -or @($validation | Where-Object { [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0) { Add-Error "工作包上下文路由缺少有效 validation：$routeId" }
        if ($requiredDocuments.Count -eq 0) { Add-Error "工作包上下文路由未声明 required_documents：$routeId" }
        $routeDocumentIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($document in $requiredDocuments) {
            $docId = [string](Get-Property $document "doc_id")
            $mode = [string](Get-Property $document "mode")
            if (-not $registryEntries.ContainsKey($docId)) { Add-Error "工作包上下文路由引用了未登记文档 '$docId'：$routeId" }
            if (-not $routeDocumentIds.Add($docId)) { Add-Error "工作包上下文路由重复引用文档 '$docId'：$routeId" }
            if ($mode -notin @("full", "summary")) { Add-Error "工作包上下文路由的文档读取模式无效 '$mode'：$routeId" }
        }
        foreach ($decision in @(Get-Property $route "decisions")) {
            $decisionId = [string]$decision
            if ($decisionId -notmatch '^DEC-\d{3,}$' -or -not $registryEntries.ContainsKey($decisionId)) { Add-Error "工作包上下文路由引用了无效或未登记决策 '$decisionId'：$routeId" }
        }
    }
    $routableStatuses = @("planned", "in-progress", "implemented", "verified", "blocked", "needs-decision")
    foreach ($workPackageId in $workPackageIds) {
        if (-not $workStatusIds.Contains($workPackageId)) { Add-Error "工作包缺少运行状态：$workPackageId" }
        $requiresCurrentRoute = $workStatusById.ContainsKey($workPackageId) -and $workStatusById[$workPackageId] -in $routableStatuses
        if ($requiresCurrentRoute -and -not $contextRouteIds.Contains($workPackageId)) { Add-Error "活动工作包缺少上下文路由：$workPackageId"; continue }
        if ($requiresCurrentRoute) {
            $requiredRoutePath = Join-Path $contextDirectory "$workPackageId.context.json"
            if (Test-Path -LiteralPath $requiredRoutePath -PathType Leaf) {
                try { $requiredRoute = Read-Utf8 $requiredRoutePath | ConvertFrom-Json -ErrorAction Stop }
                catch { $requiredRoute = $null }
                if ($null -ne $requiredRoute -and [string](Get-Property $requiredRoute "baseline") -ne $currentBaseline) { Add-Error "活动工作包上下文路由与当前基线不一致：$workPackageId" }
            }
            if ($currentManifestLoaded -and -not $currentManifestRouteIds.Contains($workPackageId)) { Add-Error "当前基线清单未锁定活动工作包上下文路由：$workPackageId" }
        }
    }
}

$taskContracts = @{}
$taskStates = @{}
$legacyTaskStateIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
if ($levelRank -ge 2) {
    $strictApprovalLog = if (Test-Path -LiteralPath $approvalLogPath -PathType Leaf) { Read-Utf8 $approvalLogPath } else { '' }
    $confirmationIds = @([regex]::Matches($strictApprovalLog, '(?m)^\s*confirmation_id:\s*(CONF-[A-Za-z0-9][A-Za-z0-9._:-]{5,127})\s*$') | ForEach-Object { $_.Groups[1].Value })
    foreach ($duplicateConfirmation in @($confirmationIds | Group-Object | Where-Object Count -gt 1)) { Add-Error "批准 confirmation_id 不得重复使用：$($duplicateConfirmation.Name)" }
    $taskRuntimeDirectory = Join-Path $root ".governance/runtime/tasks"
    $taskSchemaDefinitions = @(
        @("contract", "schemas/governed-work.schema.json"),
        @("state", "schemas/governed-work-state.schema.json"),
        @("evidence", "schemas/validation-evidence.schema.json"),
        @("review", "schemas/review-evidence.schema.json")
    )
    $taskSchemas = @{}
    foreach ($definition in $taskSchemaDefinitions) {
        $schemaFile = Join-Path $root $definition[1]
        if (-not (Test-Path -LiteralPath $schemaFile -PathType Leaf)) { continue }
        try { $taskSchemas[$definition[0]] = Read-Utf8 $schemaFile | ConvertFrom-Json -ErrorAction Stop }
        catch { Add-Error "$($definition[1]) 不是有效 JSON Schema：$($_.Exception.Message)" }
    }
    foreach ($contractFile in @(Get-ChildItem -LiteralPath $taskRuntimeDirectory -File -Filter "TASK-*.contract.json" -ErrorAction SilentlyContinue)) {
        $relativeContract = Get-RelativePath $contractFile.FullName
        try { $contract = Read-Utf8 $contractFile.FullName | ConvertFrom-Json -ErrorAction Stop }
        catch { Add-Error "AI 执行任务契约不是有效 JSON：$relativeContract"; continue }
        if ($taskSchemas.ContainsKey("contract")) { Test-JsonSchemaValue -Value $contract -Schema $taskSchemas.contract -SchemaRoot $taskSchemas.contract -JsonPath '$' -DocumentName "AI 执行任务契约 $($contractFile.Name)" }
        $taskId = [string](Get-Property $contract "task_id")
        if ($taskId -notmatch '^TASK-\d{3,}$' -or $contractFile.Name -ne "$taskId.contract.json") { Add-Error "AI 执行任务契约文件名与 task_id 不一致：$relativeContract"; continue }
        if ($taskContracts.ContainsKey($taskId)) { Add-Error "AI 执行任务契约编号重复：$taskId"; continue }
        $taskContracts[$taskId] = [pscustomobject]@{ Value=$contract; File=$contractFile; Hash=(Get-FileHash -LiteralPath $contractFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    foreach ($stateFile in @(Get-ChildItem -LiteralPath $taskRuntimeDirectory -File -Filter "TASK-*.state.json" -ErrorAction SilentlyContinue)) {
        $relativeState = Get-RelativePath $stateFile.FullName
        try { $taskState = Read-Utf8 $stateFile.FullName | ConvertFrom-Json -ErrorAction Stop }
        catch { Add-Error "AI 执行任务状态不是有效 JSON：$relativeState"; continue }
        $isLegacyTaskState = [int](Get-Property $taskState 'schema_version') -lt 2
        if ($isLegacyTaskState -and $AllowLegacyTaskStates) { [void]$legacyTaskStateIds.Add([string](Get-Property $taskState 'task_id')) }
        elseif ($taskSchemas.ContainsKey("state")) { Test-JsonSchemaValue -Value $taskState -Schema $taskSchemas.state -SchemaRoot $taskSchemas.state -JsonPath '$' -DocumentName "AI 执行任务状态 $($stateFile.Name)" }
        $taskId = [string](Get-Property $taskState "task_id")
        if ($taskId -notmatch '^TASK-\d{3,}$' -or $stateFile.Name -ne "$taskId.state.json") { Add-Error "AI 执行任务状态文件名与 task_id 不一致：$relativeState"; continue }
        if ($taskStates.ContainsKey($taskId)) { Add-Error "AI 执行任务状态编号重复：$taskId"; continue }
        $taskStates[$taskId] = [pscustomobject]@{ Value=$taskState; File=$stateFile }
    }
    $legacyMigrationEntries = @{}
    $legacyMigrationPath = Join-Path $root '.governance/runtime/legacy-task-migration.json'
    if (Test-Path -LiteralPath $legacyMigrationPath -PathType Leaf) {
        try {
            $legacyMigration = Read-Utf8 $legacyMigrationPath | ConvertFrom-Json -ErrorAction Stop
            foreach ($entry in @((Get-Property $legacyMigration 'tasks'))) {
                $entryTaskId = [string](Get-Property $entry 'task_id')
                if ($entryTaskId -match '^TASK-\d{3,}$' -and -not $legacyMigrationEntries.ContainsKey($entryTaskId)) { $legacyMigrationEntries[$entryTaskId] = $entry }
            }
        } catch { Add-Error "历史 TASK 迁移清单无效：$($_.Exception.Message)" }
    }
    foreach ($taskId in $taskContracts.Keys) {
        $contractRecord = $taskContracts[$taskId]
        $contract = $contractRecord.Value
        if ($governanceMode -eq 'TEAM_PROJECT' -and $null -ne $teamLedgerTasks -and -not $teamLedgerTasks.ContainsKey($taskId)) { Add-Error "TEAM_PROJECT AI 执行任务未登记到团队任务台账：$taskId" }
        if (-not $taskStates.ContainsKey($taskId)) { Add-Error "AI 执行任务缺少状态文件：$taskId"; continue }
        $taskState = $taskStates[$taskId].Value
        if ($AllowLegacyTaskStates -and $legacyTaskStateIds.Contains($taskId)) {
            $migrationNotices.Add("迁移事务暂时跳过尚未升级的 v1 TASK 状态；完成全部迁移后必须执行普通 Strict：$taskId")
            continue
        }
        $stateValue = [string](Get-Property $taskState "state")
        # Superseded TASKs are terminal historical records. Their immutable
        # evidence may intentionally point at the pre-replan contract, so a
        # later corrective edit to that retired contract must not invalidate
        # the active governance tree. Active states still require an exact
        # contract hash binding.
        if ($stateValue -ne 'superseded' -and [string](Get-Property $taskState "contract_sha256") -ne $contractRecord.Hash) { Add-Error "AI 执行任务契约在计划后发生变化：$taskId" }
        foreach ($field in @("task_id", "work_package", "baseline")) {
            if ([string](Get-Property $contract $field) -ne [string](Get-Property $taskState $field)) { Add-Error "AI 执行任务契约与状态的 $field 不一致：$taskId" }
        }
        $workPackage = [string](Get-Property $contract "work_package")
        $contractSchemaVersion = [int](Get-Property $contract 'schema_version')
        $isLegacyContract = $contractSchemaVersion -lt 2
        $legacyMigrationEntry = if ($legacyMigrationEntries.ContainsKey($taskId)) { $legacyMigrationEntries[$taskId] } else { $null }
        $hasBoundLegacyReviewMigration = $isLegacyContract -and $null -ne $legacyMigrationEntry -and [string](Get-Property $legacyMigrationEntry 'source_contract_sha256') -eq $contractRecord.Hash -and [string](Get-Property $legacyMigrationEntry 'disposition') -in @('reopened-for-review','pending-review')
        $taskRole = [string](Get-Property $contract "role")
        if ($isLegacyContract -and [string]::IsNullOrWhiteSpace($taskRole)) { $taskRole = 'IMPLEMENTER' }
        $hasAcceptedReviewedDelivery = $false
        if ($taskRole -eq 'REVIEWER') {
            foreach ($candidateStateRecord in $taskStates.Values) {
                $candidateState = $candidateStateRecord.Value
                $candidateReview = Get-Property $candidateState 'review'
                if ([string](Get-Property $candidateState 'state') -eq 'accepted' -and [string](Get-Property $candidateReview 'reviewer_task_id') -eq $taskId -and [string](Get-Property $candidateReview 'status') -eq 'passed') {
                    $hasAcceptedReviewedDelivery = $true
                    break
                }
            }
        }
        $isCompletedHistoricalReviewer = $taskRole -eq 'REVIEWER' -and $stateValue -eq 'verified' -and $hasAcceptedReviewedDelivery -and $null -ne $teamLedgerTasks -and $teamLedgerTasks.ContainsKey($taskId) -and [string]$teamLedgerTasks[$taskId].State -eq 'completed' -and [string](Get-Property $contract 'baseline') -ne $currentBaseline
        $executionLease = [string](Get-Property $taskState 'execution_lease')
        $executionLeaseOwner = [string](Get-Property $taskState 'execution_lease_owner')
        $executionLeaseExpires = [string](Get-Property $taskState 'execution_lease_expires_at')
        if ($stateValue -eq 'in-progress') {
            $parsedLeaseExpiry = [DateTimeOffset]::MinValue
            $rawLeaseExpiry = Get-Property $taskState 'execution_lease_expires_at'
            $validLeaseExpiry = if ($rawLeaseExpiry -is [DateTime]) { $parsedLeaseExpiry = [DateTimeOffset]::new(([DateTime]$rawLeaseExpiry).ToUniversalTime()); $true } else { [DateTimeOffset]::TryParse([string]$rawLeaseExpiry, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsedLeaseExpiry) }
            if ([string]::IsNullOrWhiteSpace($executionLease) -or [string]::IsNullOrWhiteSpace($executionLeaseOwner) -or -not $validLeaseExpiry -or $parsedLeaseExpiry -le [DateTimeOffset]::UtcNow) { Add-Error "in-progress AI 执行任务缺少有效运行租约或持有者：$taskId" }
        } elseif ($executionLease -or $executionLeaseOwner -or $executionLeaseExpires) { Add-Error "非 in-progress AI 执行任务不得保留运行租约：$taskId" }
        $minimumProfile = Get-MinimumTaskProfile $contract
        if ((Get-ProfileRank ([string](Get-Property $contract 'profile'))) -lt (Get-ProfileRank $minimumProfile)) {
            if ($isLegacyContract) { $compatibilityNotices.Add("旧版 v1 TASK 契约保留创建时档位，不追溯改写不可变风险快照：$taskId（当前 $($contract.profile)，新任务至少 $minimumProfile）") }
            else { Add-Error "AI 执行任务档位低于风险要求：$taskId（当前 $($contract.profile)，至少 $minimumProfile）" }
        }
        $semanticText = ((@((Get-Property $contract 'title'), (Get-Property $contract 'goal')) + @((Get-Property $contract 'validations') | ForEach-Object { @([string](Get-Property $_ 'command')) + @((Get-Property $_ 'args') | ForEach-Object { [string]$_ }) }) + @((Get-Property $contract 'write_paths'))) -join ' ')
        $semanticRisks = @(Get-GovernanceSemanticRiskFlags -Text $semanticText)
        if ([int](Get-Property $contract 'schema_version') -ge 2) {
            foreach ($semanticRisk in @($semanticRisks | Select-Object -Unique)) { if ($semanticRisk -notin @((Get-Property $contract 'risk_flags'))) { Add-Error "AI 执行任务未声明语义风险：$taskId -> $semanticRisk" } }
        } elseif ($semanticRisks.Count -gt 0) {
            $compatibilityNotices.Add("旧版 v1 TASK 契约保留不可变风险快照；活动风险工作建议由新版 TASK 替代：$taskId")
        }
        if ([int](Get-Property $contract 'schema_version') -ge 2 -and [string](Get-Property $contract 'profile') -eq 'Release') {
            $releaseControls = Get-Property $contract 'release_controls'
            foreach ($controlName in @('target_environment', 'execution_window', 'rollback_plan', 'observation_metrics', 'stop_conditions', 'post_release_owner')) {
                if ($null -eq $releaseControls -or [string]::IsNullOrWhiteSpace([string](Get-Property $releaseControls $controlName))) { Add-Error "Release TASK 缺少控制字段 $controlName：$taskId" }
            }
        }
        $contractReview = Get-Property $contract "review"
        if ($isLegacyContract -and $null -eq $contractReview) { $contractReview = [pscustomobject]@{ required = $true } }
        $taskReview = Get-Property $taskState "review"
        if ($governanceMode -eq 'TEAM_PROJECT') {
            if ($taskRole -notin @('ANALYST', 'ARCHITECT', 'IMPLEMENTER', 'TESTER', 'INTEGRATOR', 'REVIEWER')) { Add-Error "TEAM_PROJECT AI 执行任务缺少有效任务角色：$taskId" }
            if ($null -eq $contractReview) { Add-Error "TEAM_PROJECT AI 执行任务契约缺少不可变审核要求：$taskId" }
            elseif ($taskRole -eq 'REVIEWER' -and [string](Get-Property $contractReview 'required') -ne 'False') { Add-Error "REVIEWER 任务契约不得递归要求审核：$taskId" }
            elseif ($taskRole -ne 'REVIEWER' -and [string](Get-Property $contractReview 'required') -ne 'True') { Add-Error "TEAM_PROJECT 交付任务契约必须声明独立审核要求：$taskId" }
            if ($taskRole -eq 'REVIEWER') {
                $reviewerEvidenceScope = "docs/05-quality/evidence/$taskId"
                $reviewerWritePaths = @((Get-Property $contract 'write_paths') | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ })
                if ($reviewerWritePaths.Count -eq 0) { $reviewerWritePaths = @((Get-Property $contract 'allowed_paths') | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ }) }
                if ($reviewerWritePaths.Count -eq 0 -or @($reviewerWritePaths | Where-Object { -not (Test-PathWithinScope ([string]$_) $reviewerEvidenceScope) }).Count -gt 0) { Add-Error "REVIEWER 任务写入范围必须完全位于自己的审核证据目录：$taskId" }
                $reviewerAllowedPaths = @((Get-Property $contract 'allowed_paths') | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') } | Where-Object { $_ })
                if ($reviewerAllowedPaths.Count -eq 0 -or @($reviewerAllowedPaths | Where-Object { -not (Test-PathWithinScope ([string]$_) $reviewerEvidenceScope) }).Count -gt 0) { Add-Error "REVIEWER 任务 allowed_paths 必须完全位于自己的审核证据目录：$taskId" }
            }
            if ($null -eq $taskReview) { Add-Error "TEAM_PROJECT AI 执行任务缺少运行时审核状态：$taskId" }
            elseif ($taskRole -eq 'REVIEWER') {
                if ([string](Get-Property $taskReview 'required') -ne 'False' -or [string](Get-Property $taskReview 'status') -ne 'not-applicable') { Add-Error "REVIEWER 任务不得递归要求审核：$taskId" }
                if ($stateValue -eq 'accepted') { Add-Error "REVIEWER 任务不得处于 accepted；历史状态必须使用 MigrateReviewer 规范化并重新执行 Strict：$taskId" }
            } else {
                if ([string](Get-Property $taskReview 'required') -ne 'True') { Add-Error "TEAM_PROJECT 交付任务必须要求独立审核：$taskId" }
                $runtimeReviewerId = [string](Get-Property $taskReview 'reviewer_task_id')
                $runtimeReviewStatus = [string](Get-Property $taskReview 'status')
                $runtimePassStreak = [int](Get-Property $taskReview 'pass_streak')
                $runtimeSubjectSha256 = [string](Get-Property $taskReview 'subject_sha256')
                $requiredReviewRounds = Get-RequiredReviewRounds $contract
                if ($runtimeReviewStatus -eq 'provisional-passed' -and ($requiredReviewRounds -eq 1 -or $runtimePassStreak -ne 1)) { Add-Error "Lite 任务不得停留在 provisional-passed，其他任务首次审核通过必须具有连续通过计数 1：$taskId" }
                if ($runtimeReviewStatus -eq 'passed' -and $runtimePassStreak -lt $requiredReviewRounds) { Add-Error "最终审核通过必须具有连续通过计数 $requiredReviewRounds：$taskId" }
                if ($runtimeReviewStatus -in @('changes-required', 'cancelled') -and ($runtimePassStreak -ne 0 -or $runtimeSubjectSha256)) { Add-Error "审核未通过或取消时必须清零连续通过状态：$taskId" }
                if ($stateValue -in @('in-progress', 'implemented', 'verified', 'accepted') -and $runtimeReviewerId -notmatch '^TASK-\d{3,}$') { Add-Error "TEAM_PROJECT 交付任务开始后必须绑定审核任务：$taskId" }
                if ($runtimeReviewerId -match '^TASK-\d{3,}$') {
                    if (-not $taskContracts.ContainsKey($runtimeReviewerId)) { Add-Error "TEAM_PROJECT 交付任务引用的审核契约不存在：$taskId -> $runtimeReviewerId" }
                    else {
                        $reviewerContract = $taskContracts[$runtimeReviewerId].Value
                        if ([string](Get-Property $reviewerContract 'role') -ne 'REVIEWER' -or [string](Get-Property $reviewerContract 'work_package') -ne $workPackage) { Add-Error "TEAM_PROJECT 交付任务必须绑定同工作包的 REVIEWER 契约：$taskId -> $runtimeReviewerId" }
                        if ($taskId -notin @((Get-Property $reviewerContract 'dependencies'))) { Add-Error "审核契约必须依赖被审核任务：$runtimeReviewerId -> $taskId" }
                    }
                }
                if ($stateValue -eq 'accepted' -and ($runtimeReviewStatus -ne 'passed' -or $runtimePassStreak -lt $requiredReviewRounds)) { Add-Error "TEAM_PROJECT 交付任务 accepted 前必须完成 $requiredReviewRounds 轮独立审核：$taskId" }
                foreach ($reviewEvidence in @((Get-Property $taskReview 'evidence'))) {
                    $resolvedReviewEvidence = Resolve-ProjectPath ([string]$reviewEvidence)
                    if (-not $resolvedReviewEvidence -or -not (Test-Path -LiteralPath $resolvedReviewEvidence -PathType Leaf)) { Add-Error "独立审核证据不存在或越界：$taskId -> $reviewEvidence"; continue }
                    try { $reviewDocument = Read-Utf8 $resolvedReviewEvidence | ConvertFrom-Json -ErrorAction Stop }
                    catch { Add-Error "独立审核证据不是有效 JSON：$taskId -> $reviewEvidence"; continue }
                    if ($taskSchemas.ContainsKey('review')) { Test-JsonSchemaValue -Value $reviewDocument -Schema $taskSchemas.review -SchemaRoot $taskSchemas.review -JsonPath '$' -DocumentName "独立审核证据 $reviewEvidence" }
                    $expectedReviewEvidenceResult = if ($runtimeReviewStatus -eq 'provisional-passed') { 'passed' } else { $runtimeReviewStatus }
                    if ([string](Get-Property $reviewDocument '$schema') -ne 'schemas/review-evidence.schema.json' -or [string](Get-Property $reviewDocument 'reviewer_task_id') -ne $runtimeReviewerId -or $taskId -notin @((Get-Property $reviewDocument 'reviewed_task_ids')) -or [string](Get-Property $reviewDocument 'result') -ne $expectedReviewEvidenceResult -or [string](Get-Property $reviewDocument 'work_package') -ne $workPackage -or [string](Get-Property $reviewDocument 'baseline') -ne [string](Get-Property $contract 'baseline')) { Add-Error "独立审核证据未绑定审核任务、被审核任务、工作包、基线或审核结论：$taskId -> $reviewEvidence" }
                    if ($runtimeReviewStatus -in @('provisional-passed', 'passed', 'changes-required') -and $stateValue -ne 'accepted') {
                        $changeEntries = @((Get-Property $reviewDocument 'changes') | Where-Object { [string](Get-Property $_ 'task_id') -eq $taskId })
                        if (-not [bool](Get-Property $reviewDocument 'diff_checked') -or $changeEntries.Count -eq 0) { Add-Error "独立审核证据必须声明 diff_checked=true 并列出实际变更，不能只有自动化测试 pass：$taskId -> $reviewEvidence" }
                        $writePathsForReview = @((Get-Property $contract 'write_paths') | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                        if ($writePathsForReview.Count -eq 0) { $writePathsForReview = @(Get-Property $contract 'allowed_paths') }
                        $meaningfulChangeCount = 0
                        $declaredChangeSet = [System.Collections.Generic.HashSet[string]]::new($(if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }))
                        foreach ($changeEntry in $changeEntries) {
                            $changePath = ([string](Get-Property $changeEntry 'path')).Replace('\', '/').Trim('/')
                            $changeType = [string](Get-Property $changeEntry 'change_type')
                            $oldPath = ([string](Get-Property $changeEntry 'old_path')).Replace('\', '/').Trim('/')
                            if (@($writePathsForReview | Where-Object { Test-PathWithinScope $changePath ([string]$_) }).Count -eq 0) { Add-Error "独立审核变更路径超出交付任务写入范围：$taskId -> $changePath" }
                            if (-not (Test-ReviewSystemPath $changePath $workPackage)) { $meaningfulChangeCount++ }
                            if ($changeType -eq 'renamed') {
                                if ([string]::IsNullOrWhiteSpace($oldPath) -or @($writePathsForReview | Where-Object { Test-PathWithinScope $oldPath ([string]$_) }).Count -eq 0) { Add-Error "独立审核重命名记录缺少写入范围内的 old_path：$taskId -> $changePath" }
                                [void]$declaredChangeSet.Add("renamed|$oldPath|$changePath")
                            } else {
                                if (-not [string]::IsNullOrWhiteSpace($oldPath)) { Add-Error "非重命名审核记录不得声明 old_path：$taskId -> $changePath" }
                                [void]$declaredChangeSet.Add("$changeType|$changePath")
                            }
                        }
                        if ($meaningfulChangeCount -eq 0) { Add-Error "独立审核证据只列出治理或自动化证据文件，缺少实际项目内容变更：$taskId -> $reviewEvidence" }
                        $startCommit = [string](Get-Property $taskState 'start_git_commit')
                        if ([string]::IsNullOrWhiteSpace($startCommit)) { Add-Error "独立审核任务缺少可复核的 start_git_commit：$taskId" }
                        else {
                            try { $actualGitEntries = @(Get-GovernanceGitChangedEntries -ProjectRoot $root -BaseCommit $startCommit) }
                            catch { Add-Error "无法复核独立审核的实际 Git 变更：$taskId -> $($_.Exception.Message)"; $actualGitEntries = @() }
                            $actualChangeSet = [System.Collections.Generic.HashSet[string]]::new($(if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }))
                            $actualScopedEntries = [System.Collections.Generic.List[object]]::new()
                            foreach ($actualGitEntry in $actualGitEntries) {
                                $actualPath = ([string](Get-Property $actualGitEntry 'path')).Replace('\', '/').Trim('/')
                                $actualOldPath = ([string](Get-Property $actualGitEntry 'old_path')).Replace('\', '/').Trim('/')
                                $actualInScope = @($writePathsForReview | Where-Object { Test-PathWithinScope $actualPath ([string]$_) -or ($actualOldPath -and (Test-PathWithinScope $actualOldPath ([string]$_))) }).Count -gt 0
                                $actualMeaningful = -not (Test-ReviewSystemPath $actualPath $workPackage) -or ($actualOldPath -and -not (Test-ReviewSystemPath $actualOldPath $workPackage))
                                if (-not $actualInScope -or -not $actualMeaningful) { continue }
                                $actualScopedEntries.Add($actualGitEntry)
                                $actualType = [string](Get-Property $actualGitEntry 'change_type')
                                $actualKey = if ($actualType -eq 'renamed') { "renamed|$actualOldPath|$actualPath" } else { "$actualType|$actualPath" }
                                [void]$actualChangeSet.Add($actualKey)
                            }
                            $missingReviewChanges = @($actualChangeSet | Where-Object { -not $declaredChangeSet.Contains([string]$_) })
                            $inventedReviewChanges = @($declaredChangeSet | Where-Object { -not $actualChangeSet.Contains([string]$_) })
                            if ($missingReviewChanges.Count -gt 0 -or $inventedReviewChanges.Count -gt 0) { Add-Error "独立审核证据与实际 Git 变更路径或类型不一致：$taskId -> $reviewEvidence" }
                            if ($runtimeReviewStatus -in @('provisional-passed', 'passed') -and $stateValue -ne 'accepted') {
                                try { $actualSubjectSha256 = Get-GovernanceGitEntriesSha256 -ProjectRoot $root -Entries @($actualScopedEntries) }
                                catch { Add-Error "无法计算独立审核对象指纹：$taskId -> $($_.Exception.Message)"; $actualSubjectSha256 = '' }
                                if (-not $runtimeSubjectSha256 -or $runtimeSubjectSha256 -ne $actualSubjectSha256) { Add-Error "连续审核通过所绑定的最终变更指纹不一致：$taskId" }
                            }
                        }
                    }
                }
                if ($runtimeReviewStatus -in @('provisional-passed', 'passed') -and $runtimeReviewerId -match '^TASK-\d{3,}$' -and $taskStates.ContainsKey($runtimeReviewerId)) {
                    $requiredPassedRounds = if ($runtimeReviewStatus -eq 'passed') { $requiredReviewRounds } else { 1 }
                    $matchingPassedRounds = [System.Collections.Generic.HashSet[string]]::new($(if ([System.IO.Path]::DirectorySeparatorChar -eq [char]92) { [System.StringComparer]::OrdinalIgnoreCase } else { [System.StringComparer]::Ordinal }))
                    $reviewerRuntimeState = $taskStates[$runtimeReviewerId].Value
                    foreach ($historyEntry in @((Get-Property $reviewerRuntimeState 'review_history') | Where-Object { [string](Get-Property $_ 'result') -eq 'passed' })) {
                        $historyPath = [string](Get-Property $historyEntry 'path')
                        $historyRoundId = [string](Get-Property $historyEntry 'round_id')
                        if ($historyRoundId -notmatch '^RR-[0-9a-f]{32}$') { continue }
                        $resolvedHistoryPath = Resolve-ProjectPath $historyPath
                        if (-not $resolvedHistoryPath -or -not (Test-Path -LiteralPath $resolvedHistoryPath -PathType Leaf)) { continue }
                        try { $historyReviewDocument = Read-Utf8 $resolvedHistoryPath | ConvertFrom-Json -ErrorAction Stop } catch { continue }
                        if ([string](Get-Property $historyReviewDocument 'reviewer_task_id') -eq $runtimeReviewerId -and [string](Get-Property $historyReviewDocument 'result') -eq 'passed' -and $taskId -in @((Get-Property $historyReviewDocument 'reviewed_task_ids')) -and [string](Get-Property $historyReviewDocument 'work_package') -eq $workPackage -and [string](Get-Property $historyReviewDocument 'baseline') -eq [string](Get-Property $contract 'baseline')) { [void]$matchingPassedRounds.Add($historyRoundId) }
                    }
                    if ($matchingPassedRounds.Count -lt $requiredPassedRounds) { Add-Error "交付任务缺少连续审核通过所需的独立证据轮次：$taskId（需要 $requiredPassedRounds，实际 $($matchingPassedRounds.Count)）" }
                }
            }
        }
        if (-not $workPackageIds.Contains($workPackage)) { Add-Error "AI 执行任务引用了未定义工作包：$taskId -> $workPackage" }
        $taskRoutePath = Join-Path $root "docs/04-delivery/context/$workPackage.context.json"
        if ($stateValue -notin @('accepted', 'superseded', 'needs-decision') -and -not $isCompletedHistoricalReviewer -and -not ($AllowLegacyTaskStates -and $isLegacyContract) -and -not $hasBoundLegacyReviewMigration -and (Test-Path -LiteralPath $taskRoutePath -PathType Leaf)) {
            try { $taskRoute = Read-Utf8 $taskRoutePath | ConvertFrom-Json -ErrorAction Stop } catch { $taskRoute = $null }
            if ($null -ne $taskRoute) {
                if ([string](Get-Property $taskRoute "baseline") -ne [string](Get-Property $contract "baseline")) { Add-Error "AI 执行任务与工作包路由基线不一致：$taskId" }
                $routeScopes = @((Get-Property $taskRoute "scope") | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') })
                $readPaths = @((Get-Property $contract "read_paths") | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
                if ($readPaths.Count -eq 0) { $readPaths = @(Get-Property $contract "allowed_paths") }
                foreach ($readPath in $readPaths) {
                    $normalizedRead = ([string]$readPath).Replace('\', '/').Trim('/')
                    if (@($routeScopes | Where-Object { $normalizedRead.Equals($_, $script:pathComparison) -or $normalizedRead.StartsWith($_ + '/', $script:pathComparison) }).Count -eq 0) { Add-Error "AI 执行任务读取路径超出工作包上下文路由：$taskId -> $readPath" }
                }
                if ($taskRole -ne 'REVIEWER') {
                    $routedWritePaths = @((Get-Property $contract 'write_paths') | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
                    if ($routedWritePaths.Count -eq 0) { $routedWritePaths = @(Get-Property $contract 'allowed_paths') }
                    foreach ($writePath in $routedWritePaths) {
                        $normalizedWrite = ([string]$writePath).Replace('\', '/').Trim('/')
                        if (@($routeScopes | Where-Object { Test-PathWithinScope $normalizedWrite ([string]$_) }).Count -eq 0) { Add-Error "AI 执行任务写入路径超出工作包上下文路由：$taskId -> $writePath" }
                    }
                }
                $routeDocumentIds = @((Get-Property $taskRoute "required_documents") | ForEach-Object { [string](Get-Property $_ "doc_id") }) + @((Get-Property $taskRoute "decisions") | ForEach-Object { [string]$_ })
                $contractDocumentIds = @((Get-Property $contract "authoritative_documents"))
                if (@(Compare-Object -ReferenceObject @($routeDocumentIds | Sort-Object -Unique) -DifferenceObject @($contractDocumentIds | Sort-Object -Unique)).Count -gt 0) { Add-Error "AI 执行任务未完整绑定工作包路由的权威文档：$taskId" }
            }
        }
        foreach ($docId in @((Get-Property $contract "authoritative_documents"))) {
            if (-not $registryEntries.ContainsKey([string]$docId)) { Add-Error "AI 执行任务引用了未登记权威文档：$taskId -> $docId" }
        }
        $validationIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($validation in @((Get-Property $contract "validations"))) {
            $validationId = [string](Get-Property $validation "id")
            if (-not $validationIds.Add($validationId)) { Add-Error "AI 执行任务包含重复验证编号：$taskId -> $validationId" }
        }
        $writePaths = @((Get-Property $contract "write_paths") | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($writePaths.Count -eq 0) { $writePaths = @(Get-Property $contract "allowed_paths") }
        foreach ($writePath in $writePaths) {
            $resolvedWrite = Resolve-ProjectPath ([string]$writePath)
            if (-not $resolvedWrite -or $resolvedWrite -eq $root) { Add-Error "AI 执行任务包含越界或过宽写入路径：$taskId -> $writePath" }
            if (([string]$writePath).Replace('\', '/') -match '^(?i)(?:\.git|\.governance)(?:/|$)') { Add-Error "AI 执行任务不得接管运行时或版本库控制路径：$taskId -> $writePath" }
            if (Test-ProjectPathContainsLink ([string]$writePath)) { Add-Error "AI 执行任务路径经过符号链接或目录联接：$taskId -> $writePath" }
        }
        foreach ($dependencyId in @((Get-Property $contract "dependencies"))) {
            if ([string]$dependencyId -eq $taskId -or -not $taskContracts.ContainsKey([string]$dependencyId)) { Add-Error "AI 执行任务依赖无效：$taskId -> $dependencyId" }
        }
        $repairTargets = @((Get-Property $contract 'repair_of') | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique)
        foreach ($repairTarget in $repairTargets) {
            if ($repairTarget -notin @((Get-Property $contract 'dependencies'))) { Add-Error "AI 修复任务 repair_of 必须同时属于 dependencies：$taskId -> $repairTarget" }
        }
        if ($taskRole -eq 'REVIEWER' -and $repairTargets.Count -gt 0) { Add-Error "REVIEWER 任务不得声明 repair_of：$taskId" }
        if ($stateValue -in @('in-progress', 'implemented', 'verified') -and [string](Get-Property $contract "baseline") -ne $currentBaseline -and -not $isCompletedHistoricalReviewer -and -not ($AllowLegacyTaskStates -and $isLegacyContract) -and -not $hasBoundLegacyReviewMigration) { Add-Error "活动 AI 执行任务使用了过期基线：$taskId" }
        $evidencePaths = @((Get-Property $taskState "evidence"))
        $evidenceHistory = @((Get-Property $taskState "evidence_history"))
        if (@($evidencePaths | Where-Object { $_ -and $_ -notin $evidenceHistory }).Count -gt 0) { Add-Error "AI 执行任务当前证据未纳入 evidence_history：$taskId" }
        if ($stateValue -in @('verified', 'accepted') -and $evidencePaths.Count -ne $validationIds.Count) { Add-Error "已验证 AI 执行任务的证据数量与验证计划不一致：$taskId" }
        $evidenceValidationIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($evidencePath in @($evidencePaths + $evidenceHistory | Select-Object -Unique)) {
            $isCurrentEvidence = $evidencePaths -contains $evidencePath
            $resolvedEvidence = Resolve-ProjectPath ([string]$evidencePath)
            if (-not $resolvedEvidence -or -not (Test-Path -LiteralPath $resolvedEvidence -PathType Leaf)) { Add-Error "AI 执行任务证据不存在或越界：$taskId -> $evidencePath"; continue }
            try { $evidence = Read-Utf8 $resolvedEvidence | ConvertFrom-Json -ErrorAction Stop }
            catch { Add-Error "AI 执行任务证据不是有效 JSON：$evidencePath"; continue }
            if ([string](Get-Property $evidence '$schema') -eq 'schemas/review-evidence.schema.json') {
                if ($taskRole -ne 'REVIEWER') { Add-Error "只有 REVIEWER 任务可以在 evidence_history 中保存审核证据：$taskId -> $evidencePath" }
                if ($taskSchemas.ContainsKey('review')) { Test-JsonSchemaValue -Value $evidence -Schema $taskSchemas.review -SchemaRoot $taskSchemas.review -JsonPath '$' -DocumentName "独立审核证据 $evidencePath" }
                $reviewedEvidenceTaskIds = @((Get-Property $evidence 'reviewed_task_ids') | ForEach-Object { [string]$_ } | Select-Object -Unique)
                $reviewEvidenceSubjectsValid = $reviewedEvidenceTaskIds.Count -gt 0
                foreach ($reviewedEvidenceTaskId in $reviewedEvidenceTaskIds) {
                    if (-not $taskContracts.ContainsKey($reviewedEvidenceTaskId)) { $reviewEvidenceSubjectsValid = $false; continue }
                    $reviewedEvidenceContract = $taskContracts[$reviewedEvidenceTaskId].Value
                    if ([string](Get-Property $reviewedEvidenceContract 'work_package') -ne $workPackage -or [string](Get-Property $reviewedEvidenceContract 'baseline') -ne [string](Get-Property $evidence 'baseline') -or $reviewedEvidenceTaskId -notin @((Get-Property $contract 'dependencies'))) { $reviewEvidenceSubjectsValid = $false }
                }
                if ([string](Get-Property $evidence 'reviewer_task_id') -ne $taskId -or [string](Get-Property $evidence 'work_package') -ne $workPackage -or -not $reviewEvidenceSubjectsValid) { Add-Error "审核证据未绑定 REVIEWER 任务契约及其被审核交付基线：$taskId -> $evidencePath" }
                $reviewHistoryEntries = @((Get-Property $taskState 'review_history') | Where-Object { [string](Get-Property $_ 'path') -eq [string]$evidencePath })
                $currentReviewHash = (Get-FileHash -LiteralPath $resolvedEvidence -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($reviewHistoryEntries.Count -ne 1 -or [string](Get-Property $reviewHistoryEntries[0] 'sha256') -ne $currentReviewHash) { Add-Error "审核证据缺少不可变哈希记录或内容已改变：$taskId -> $evidencePath" }
                continue
            }
            if ($taskSchemas.ContainsKey("evidence")) { Test-JsonSchemaValue -Value $evidence -Schema $taskSchemas.evidence -SchemaRoot $taskSchemas.evidence -JsonPath '$' -DocumentName "验证证据 $evidencePath" }
            if ([string](Get-Property $evidence "task_id") -ne $taskId -or ($stateValue -ne 'superseded' -and [string](Get-Property $evidence "contract_sha256") -ne $contractRecord.Hash) -or [string](Get-Property $evidence "baseline") -ne [string](Get-Property $contract "baseline")) { Add-Error "验证证据未绑定当前任务契约：$evidencePath" }
            $evidenceValidationId = [string](Get-Property $evidence "validation_id")
            if (-not $validationIds.Contains($evidenceValidationId)) { Add-Error "验证证据不属于任务验证计划：$evidencePath" }
            if ($isCurrentEvidence -and -not $evidenceValidationIds.Add($evidenceValidationId)) { Add-Error "AI 执行任务当前批次重复引用同一验证的证据：$taskId -> $evidenceValidationId" }
            if ($isCurrentEvidence -and $stateValue -in @('verified', 'accepted') -and [int](Get-Property $evidence "exit_code") -ne 0) { Add-Error "已验证任务包含失败证据：$evidencePath" }
            $outputPath = [string](Get-Property $evidence "output_path")
            $resolvedOutput = if ($outputPath) { Resolve-ProjectPath $outputPath } else { $null }
            if (-not $resolvedOutput -or -not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) { Add-Error "验证证据输出不存在或越界：$evidencePath" }
            else {
                $outputHash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($outputHash -ne [string](Get-Property $evidence "output_sha256")) { Add-Error "验证证据输出哈希不一致：$evidencePath" }
            }
        }
        $approvalLog = if (Test-Path -LiteralPath $approvalLogPath -PathType Leaf) { Read-Utf8 $approvalLogPath } else { '' }
        if ((@((Get-Property $contract "risk_flags")).Count -gt 0 -or [string](Get-Property $contract 'profile') -eq 'Release') -and $stateValue -in @('in-progress', 'implemented', 'verified', 'accepted')) {
            $executionApproval = [regex]::Matches($approvalLog, '(?ms)^\s*approval_id:\s*APR-\d+\s*$.*?(?=^\s*approval_id:\s*APR-|\z)') | Where-Object { Test-TaskApprovalBinding -Block $_.Value -Type 'execution' -TaskId $taskId -PlanHash $contractRecord.Hash -Baseline ([string](Get-Property $contract "baseline")) }
            if (@($executionApproval).Count -eq 0) {
                if ($hasBoundLegacyReviewMigration) { $compatibilityNotices.Add("迁移清单已绑定旧版 v1 TASK 原契约哈希，不追溯伪造 execution 批准：$taskId") }
                else { Add-Error "风险任务缺少绑定契约哈希的 execution 批准：$taskId" }
            }
        }
        if ($stateValue -eq 'accepted') {
            $acceptanceId = [string](Get-Property $taskState "approval_id")
            $acceptanceMatch = [regex]::Match($approvalLog, "(?ms)^\s*approval_id:\s*$([regex]::Escape($acceptanceId))\s*$.*?(?=^\s*approval_id:\s*APR-|\z)")
            $acceptanceSubjectSha256 = [string](Get-Property $taskState 'acceptance_subject_sha256')
            $acceptanceEvidenceSha256 = [string](Get-Property $taskState 'acceptance_evidence_sha256')
            if ($acceptanceSubjectSha256 -notmatch '^[0-9a-f]{64}$' -or $acceptanceEvidenceSha256 -notmatch '^[0-9a-f]{64}$') { Add-Error "accepted 任务缺少冻结的最终内容和证据快照；必须重新记录 acceptance：$taskId" }
            if ($acceptanceEvidenceSha256 -match '^[0-9a-f]{64}$') {
                try { $currentAcceptanceEvidenceSha256 = Get-GovernanceFileSetSha256 -ProjectRoot $root -RelativePaths $evidencePaths }
                catch { Add-Error "无法复核 accepted 任务的冻结证据快照：$taskId -> $($_.Exception.Message)"; $currentAcceptanceEvidenceSha256 = '' }
                if ($currentAcceptanceEvidenceSha256 -ne $acceptanceEvidenceSha256) { Add-Error "accepted 任务的冻结验证证据已被修改：$taskId" }
            }
            if (-not $acceptanceMatch.Success -or -not (Test-TaskApprovalBinding -Block $acceptanceMatch.Value -Type 'acceptance' -TaskId $taskId -PlanHash $contractRecord.Hash -Baseline ([string](Get-Property $contract "baseline")) -SubjectSha256 $acceptanceSubjectSha256 -EvidenceSha256 $acceptanceEvidenceSha256)) { Add-Error "accepted 任务缺少绑定最终内容和当前证据的 acceptance 批准：$taskId" }
        }
    }
    foreach ($taskId in $taskStates.Keys) { if (-not $taskContracts.ContainsKey($taskId)) { Add-Error "AI 执行任务状态缺少契约文件：$taskId" } }
    foreach ($workPackageId in $workPackageIds) {
        $packageStates = @($taskStates.Values | Where-Object { [string](Get-Property $_.Value "work_package") -eq $workPackageId } | ForEach-Object {
            $packageTaskId = [string](Get-Property $_.Value 'task_id')
            $packageState = [string](Get-Property $_.Value 'state')
            $packageRole = if ($taskContracts.ContainsKey($packageTaskId)) { [string](Get-Property $taskContracts[$packageTaskId].Value 'role') } else { '' }
            if ($packageRole -eq 'REVIEWER' -and $packageState -eq 'verified') { 'accepted' } else { $packageState }
        })
        if ($packageStates.Count -eq 0 -or -not $workStatusById.ContainsKey($workPackageId)) { continue }
        $expectedStatus = if ('needs-decision' -in $packageStates) { 'needs-decision' }
            elseif ('blocked' -in $packageStates) { 'blocked' }
            elseif ('in-progress' -in $packageStates) { 'in-progress' }
            elseif ('implemented' -in $packageStates) { 'implemented' }
            elseif (@($packageStates | Where-Object { $_ -ne 'superseded' }).Count -eq 0) { 'superseded' }
            elseif (@($packageStates | Where-Object { $_ -notin @('accepted', 'superseded') }).Count -eq 0) { 'accepted' }
            elseif (@($packageStates | Where-Object { $_ -notin @('verified', 'accepted', 'superseded') }).Count -eq 0) { 'verified' }
            else { 'planned' }
        if ($workStatusById[$workPackageId] -ne $expectedStatus -and -not $AllowLegacyTaskStates) { Add-Error "工作包状态与 TASK 聚合状态不一致：$workPackageId（应为 $expectedStatus）" }
    }
    $activeTaskIds = @($taskStates.Keys | Where-Object { [string](Get-Property $taskStates[$_].Value "state") -eq 'in-progress' })
    for ($leftIndex = 0; $leftIndex -lt $activeTaskIds.Count; $leftIndex++) {
        for ($rightIndex = $leftIndex + 1; $rightIndex -lt $activeTaskIds.Count; $rightIndex++) {
            $leftId = $activeTaskIds[$leftIndex]; $rightId = $activeTaskIds[$rightIndex]
            foreach ($leftScope in @((Get-Property $taskContracts[$leftId].Value "allowed_paths"))) {
                foreach ($rightScope in @((Get-Property $taskContracts[$rightId].Value "allowed_paths"))) {
                    $leftPath = ([string]$leftScope).Replace('\', '/').Trim('/'); $rightPath = ([string]$rightScope).Replace('\', '/').Trim('/')
                    if ($leftPath.Equals($rightPath, $script:pathComparison) -or $leftPath.StartsWith($rightPath + '/', $script:pathComparison) -or $rightPath.StartsWith($leftPath + '/', $script:pathComparison)) { Add-Error "进行中的 AI 执行任务范围重叠：$leftId 与 $rightId" }
                }
            }
        }
    }
}

$changeDirectory = Join-Path $root "docs/08-changes"
$changeFiles = @(Get-ChildItem -LiteralPath $changeDirectory -File -Filter "CR-*.md" -ErrorAction SilentlyContinue)
foreach ($file in $changeFiles) {
    if ($file.Name -eq "CR-TEMPLATE.md") { continue }
    $content = Read-Utf8 $file.FullName
    foreach ($requiredText in @("Current baseline|当前基线", "Impact analysis|影响分析", "Resulting baseline|变更后基线")) {
        if ($content -notmatch "(?i)$requiredText") { Add-Error "变更包缺少必要章节 '$requiredText'：$($file.Name)" }
    }
}

Write-Host "项目：$root"
Write-Host "级别：$Level"
Write-Host "扫描文档数：$($documents.Count)"
Write-Host "错误数：$($errors.Count)"
Write-Host "警告数：$($warnings.Count)"
if ($migrationNotices.Count -gt 0) { Write-Host "迁移提示数：$($migrationNotices.Count)" }
if ($compatibilityNotices.Count -gt 0) { Write-Host "兼容提示数：$($compatibilityNotices.Count)" }
foreach ($message in $errors) { Write-Host "错误：$message" -ForegroundColor Red }
foreach ($message in $warnings) { Write-Host "警告：$message" -ForegroundColor Yellow }
foreach ($message in $migrationNotices) { Write-Host "迁移提示：$message" -ForegroundColor Cyan }
foreach ($message in $compatibilityNotices) { Write-Host "兼容提示：$message" -ForegroundColor Cyan }

if ($errors.Count -gt 0 -or ($levelRank -ge 2 -and $warnings.Count -gt 0)) { exit 1 }
Write-Host "治理检查通过。" -ForegroundColor Green
exit 0
