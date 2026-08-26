<#
    Installs the built plugin into a Total Commander directory and registers it
    in wincmd.ini. Re-runnable: existing BSLView.ini settings are kept and only
    missing keys are appended.

    Total Commander rewrites wincmd.ini from memory when it exits, so it must be
    closed first or the registration would be lost.
#>
[CmdletBinding()]
param(
    [string] $TcDir,
    [string] $IniFile,
    # Plugin file names that BSLView must be listed before. Lister tries plugins
    # in ini order, so a plugin claiming the same extension wins if it comes first.
    [string[]] $PromoteBefore,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot

# ---------------------------------------------------------------- locate TC

if (-not $TcDir) {
    $running = Get-Process -Name TOTALCMD, TOTALCMD64 -ErrorAction SilentlyContinue |
               Where-Object { $_.Path } | Select-Object -First 1
    if ($running) { $TcDir = Split-Path -Parent $running.Path }
}
if (-not $TcDir) {
    foreach ($k in 'HKCU:\Software\Ghisler\Total Commander', 'HKLM:\Software\Ghisler\Total Commander') {
        if (Test-Path $k) {
            $d = (Get-ItemProperty $k).InstallDir
            if ($d -and (Test-Path -LiteralPath $d)) { $TcDir = $d; break }
        }
    }
}
if (-not $TcDir -or -not (Test-Path -LiteralPath $TcDir)) {
    throw "Could not locate Total Commander. Pass -TcDir explicitly."
}
$TcDir = (Resolve-Path -LiteralPath $TcDir).Path
Write-Host "Total Commander: $TcDir"

# A portable install keeps wincmd.ini next to the executable; a setup install
# uses %APPDATA%\GHISLER. Prefer whichever actually exists, portable first.
if (-not $IniFile) {
    foreach ($c in (Join-Path $TcDir 'wincmd.ini'), (Join-Path $env:APPDATA 'GHISLER\wincmd.ini')) {
        if (Test-Path -LiteralPath $c) { $IniFile = $c; break }
    }
}
if (-not $IniFile -or -not (Test-Path -LiteralPath $IniFile)) { throw "wincmd.ini not found." }
Write-Host "Config:          $IniFile"

# ------------------------------------------------------------- safety checks

$busy = Get-Process -Name TOTALCMD, TOTALCMD64 -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($TcDir, 'OrdinalIgnoreCase') }
if ($busy -and -not $Force) {
    throw "Total Commander is running (PID $($busy.Id -join ', ')). Close it first: it rewrites wincmd.ini on exit and would discard the registration."
}

foreach ($f in 'BSLView.wlx', 'BSLView.wlx64', 'BSLView.ini', 'pluginst.inf') {
    if (-not (Test-Path -LiteralPath (Join-Path $repo $f))) { throw "Missing $f - run build.bat first." }
}
if (-not (Test-Path -LiteralPath (Join-Path $repo 'web\vs\loader.js'))) {
    throw "web\vs is missing - run tools\fetch-monaco.ps1 first."
}

# ------------------------------------------------- find or choose target dir

$iniLines = @(Get-Content -LiteralPath $IniFile -Encoding Default)
$secStart = -1
for ($i = 0; $i -lt $iniLines.Count; $i++) {
    if ($iniLines[$i].Trim() -eq '[ListerPlugins]') { $secStart = $i; break }
}
if ($secStart -lt 0) { throw "No [ListerPlugins] section in wincmd.ini." }

$secEnd = $iniLines.Count
for ($i = $secStart + 1; $i -lt $iniLines.Count; $i++) {
    if ($iniLines[$i] -match '^\s*\[') { $secEnd = $i; break }
}

$slot = $null
$maxIndex = -1
for ($i = $secStart + 1; $i -lt $secEnd; $i++) {
    if ($iniLines[$i] -match '^\s*(\d+)\s*=\s*(.+?)\s*$') {
        $idx = [int]$Matches[1]
        $path = $Matches[2]
        if ($idx -gt $maxIndex) { $maxIndex = $idx }
        if ($path -match 'BSLView\.wlx') { $slot = @{ Index = $idx; Path = $path; Line = $i } }
    }
}

if ($slot) {
    $expanded = $slot.Path -replace '(?i)%COMMANDER_PATH%', $TcDir
    $targetDir = Split-Path -Parent $expanded
    Write-Host "Existing entry:  #$($slot.Index) -> $($slot.Path)"
} else {
    $targetDir = Join-Path $TcDir 'plugins\wlx\BSLView'
    Write-Host "No existing entry; will register a new one."
}
Write-Host "Target:          $targetDir"

# --------------------------------------------------------------- copy files

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
foreach ($f in 'BSLView.wlx', 'BSLView.wlx64', 'pluginst.inf') {
    Copy-Item -LiteralPath (Join-Path $repo $f) -Destination $targetDir -Force
}

# Replace web\ wholesale: stale Monaco files from an older version would be
# served alongside the new ones.
$webTarget = Join-Path $targetDir 'web'
if (Test-Path -LiteralPath $webTarget) { Remove-Item -LiteralPath $webTarget -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $repo 'web') -Destination $webTarget -Recurse -Force

$copied = (Get-ChildItem -LiteralPath $targetDir -Recurse -File | Measure-Object -Property Length -Sum)
Write-Host ("Copied {0} files, {1:N1} MB" -f $copied.Count, ($copied.Sum / 1MB))

# ------------------------------------------------------- merge BSLView.ini

$pluginIni = Join-Path $targetDir 'BSLView.ini'
if (-not (Test-Path -LiteralPath $pluginIni)) {
    Copy-Item -LiteralPath (Join-Path $repo 'BSLView.ini') -Destination $pluginIni -Force
    Write-Host "BSLView.ini:     created"
} else {
    $existing = @(Get-Content -LiteralPath $pluginIni -Encoding Default)
    $added = @()
    $defaults = @(
        @{ Section = 'Options';    Key = 'MaxFileSizeMB';  Value = '64'; Comment = '; Files larger than this are left to the built-in viewer' },
        @{ Section = 'Options';    Key = 'KeepWarm';       Value = '1';  Comment = '; Keep one WebView2 instance resident between files' },
        @{ Section = 'Extensions'; Key = 'TextExtensions'; Value = 'md;markdown;json;xml;ps1;psm1;psd1;html;htm'; Comment = '; Other text/code extensions' }
    )
    foreach ($d in $defaults) {
        if ($existing -match "^\s*$($d.Key)\s*=") { continue }
        $at = -1
        for ($i = 0; $i -lt $existing.Count; $i++) {
            if ($existing[$i].Trim() -eq "[$($d.Section)]") { $at = $i }
            elseif ($at -ge 0 -and $existing[$i] -match '^\s*\[') { break }
        }
        if ($at -lt 0) { continue }
        $end = $existing.Count
        for ($i = $at + 1; $i -lt $existing.Count; $i++) {
            if ($existing[$i] -match '^\s*\[') { $end = $i; break }
        }
        $tail = @(if ($end -lt $existing.Count) { @('') + $existing[$end..($existing.Count - 1)] })
        $existing = @($existing[0..($end - 1)]) + @('', $d.Comment, "$($d.Key)=$($d.Value)") + $tail
        $added += $d.Key
    }
    if ($added.Count) {
        Set-Content -LiteralPath $pluginIni -Value $existing -Encoding Default
        Write-Host "BSLView.ini:     kept, added $($added -join ', ')"
    } else {
        Write-Host "BSLView.ini:     kept, already up to date"
    }
}

# ------------------------------------------------------- register in wincmd

function Get-DetectString([string] $iniPath) {
    $get = {
        param($section, $key, $fallback)
        $inSection = $false
        foreach ($line in (Get-Content -LiteralPath $iniPath -Encoding Default)) {
            if ($line -match '^\s*\[(.+)\]') { $inSection = ($Matches[1] -eq $section); continue }
            if ($inSection -and $line -match "^\s*$key\s*=\s*(.*?)\s*$") { return $Matches[1] }
        }
        return $fallback
    }
    $all = @()
    $all += (& $get 'Extensions' 'BSLExtensions' 'bsl;os')
    $all += (& $get 'Extensions' 'QueryExtensions' 'sdbl;query')
    $all += (& $get 'Extensions' 'TextExtensions' 'md;markdown;json;xml;ps1;psm1;psd1;html;htm')
    $parts = $all -join ';' -split ';' | Where-Object { $_ } | ForEach-Object { 'EXT="' + $_.ToUpper() + '"' }
    return '"' + ($parts -join ' | ') + '"'
}

$detect = Get-DetectString $pluginIni

$relPath = $targetDir
if ($targetDir.StartsWith($TcDir, 'OrdinalIgnoreCase')) {
    $relPath = '%COMMANDER_PATH%' + $targetDir.Substring($TcDir.Length)
}
$entryPath = Join-Path $relPath 'BSLView.wlx'

Copy-Item -LiteralPath $IniFile -Destination "$IniFile.bak" -Force

if ($slot) {
    $index = $slot.Index
    $iniLines[$slot.Line] = "$index=$entryPath"
    $detectLine = "${index}_detect=$detect"
    $found = $false
    for ($i = $secStart + 1; $i -lt $secEnd; $i++) {
        if ($iniLines[$i] -match "^\s*${index}_detect\s*=") { $iniLines[$i] = $detectLine; $found = $true; break }
    }
    if (-not $found) {
        $iniLines = @($iniLines[0..$slot.Line]) + @($detectLine) +
                    @($iniLines[($slot.Line + 1)..($iniLines.Count - 1)])
    }
    Write-Host "wincmd.ini:      updated entry #$index"
} else {
    $index = $maxIndex + 1
    $insertAt = $secEnd - 1
    $iniLines = @($iniLines[0..$insertAt]) + @("$index=$entryPath", "${index}_detect=$detect") +
                @(if (($insertAt + 1) -lt $iniLines.Count) { $iniLines[($insertAt + 1)..($iniLines.Count - 1)] })
    Write-Host "wincmd.ini:      added entry #$index"
}

Set-Content -LiteralPath $IniFile -Value $iniLines -Encoding Default

# ------------------------------------------------------------ reorder entries

if ($PromoteBefore) {
    $lines = @(Get-Content -LiteralPath $IniFile -Encoding Default)

    function Find-Section([object[]] $src, [string] $name) {
        $s = -1
        for ($i = 0; $i -lt $src.Count; $i++) {
            if ($src[$i].Trim() -eq "[$name]") { $s = $i; break }
        }
        if ($s -lt 0) { return $null }
        $e = $src.Count
        for ($i = $s + 1; $i -lt $src.Count; $i++) {
            if ($src[$i] -match '^\s*\[') { $e = $i; break }
        }
        return @{ Start = $s; End = $e }
    }

    $ps = Find-Section $lines 'ListerPlugins'
    $fs = Find-Section $lines 'ListerPlugins64'

    # The 64-bit flags are keyed by the same indices, so they have to travel
    # with their plugin rather than stay with the number.
    $flags = @{}
    $flagExtras = @()
    if ($fs) {
        for ($i = $fs.Start + 1; $i -lt $fs.End; $i++) {
            if ($lines[$i] -match '^\s*(\d+)\s*=\s*(.*?)\s*$') { $flags[[int]$Matches[1]] = $Matches[2] }
            elseif ($lines[$i].Trim()) { $flagExtras += $lines[$i] }
        }
    }

    $entries = @()
    $extras = @()
    $byIndex = @{}
    for ($i = $ps.Start + 1; $i -lt $ps.End; $i++) {
        if ($lines[$i] -match '^\s*(\d+)_detect\s*=\s*(.*?)\s*$') {
            $t = $byIndex[[int]$Matches[1]]
            if ($t) { $t.Detect = $Matches[2] }
        } elseif ($lines[$i] -match '^\s*(\d+)\s*=\s*(.+?)\s*$') {
            $n = [int]$Matches[1]
            $obj = [pscustomobject]@{ Index = $n; Path = $Matches[2]; Detect = $null; Flag = $flags[$n] }
            $entries += $obj
            $byIndex[$n] = $obj
        } elseif ($lines[$i].Trim()) {
            $extras += $lines[$i]
        }
    }
    $entries = @($entries | Sort-Object Index)

    $bslPos = -1
    for ($i = 0; $i -lt $entries.Count; $i++) {
        if ($entries[$i].Path -match 'BSLView\.wlx') { $bslPos = $i; break }
    }
    # Accept both -PromoteBefore a,b and a single comma-separated argument, since
    # powershell.exe -File cannot pass an array.
    $patterns = @($PromoteBefore | ForEach-Object { $_ -split ',' } |
                  ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ })

    $targetPos = $entries.Count
    $matched = @()
    foreach ($p in $patterns) {
        for ($i = 0; $i -lt $entries.Count; $i++) {
            if ($entries[$i].Path -match [regex]::Escape($p)) {
                $matched += $p
                if ($i -lt $targetPos) { $targetPos = $i }
            }
        }
    }

    if ($bslPos -lt 0) {
        Write-Warning "Order: BSLView entry not found; skipping reorder."
    } elseif (-not $matched) {
        Write-Warning "Order: none of [$($patterns -join ', ')] are registered; nothing to promote past."
    } elseif ($targetPos -ge $bslPos) {
        Write-Host "Order:           already ahead of $($matched -join ', ')"
    } else {
        $slots = @($entries | ForEach-Object { $_.Index })
        $list = [System.Collections.ArrayList]::new()
        [void]$list.AddRange($entries)
        $moved = $list[$bslPos]
        $list.RemoveAt($bslPos)
        $list.Insert($targetPos, $moved)

        $body = @($extras)
        for ($i = 0; $i -lt $list.Count; $i++) {
            $n = $slots[$i]
            $body += "$n=$($list[$i].Path)"
            if ($null -ne $list[$i].Detect) { $body += "${n}_detect=$($list[$i].Detect)" }
        }
        $lines = @($lines[0..$ps.Start]) + $body +
                 @(if ($ps.End -lt $lines.Count) { $lines[$ps.End..($lines.Count - 1)] })

        if ($fs) {
            $fs = Find-Section $lines 'ListerPlugins64'
            $fbody = @($flagExtras)
            for ($i = 0; $i -lt $list.Count; $i++) {
                if ($null -ne $list[$i].Flag) { $fbody += "$($slots[$i])=$($list[$i].Flag)" }
            }
            $lines = @($lines[0..$fs.Start]) + $fbody +
                     @(if ($fs.End -lt $lines.Count) { $lines[$fs.End..($lines.Count - 1)] })
        }

        Set-Content -LiteralPath $IniFile -Value $lines -Encoding Default
        Write-Host "Order:           moved BSLView from #$($slots[$bslPos]) to #$($slots[$targetPos])"
    }
}

Write-Host ""
Write-Host "Done. Detect string:"
Write-Host "  $detect"
Write-Host "Backup of wincmd.ini: $IniFile.bak"
