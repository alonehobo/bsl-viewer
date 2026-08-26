<#
    Downloads Monaco Editor, marked and turndown into web\vs and web\*.min.js.

    Monaco ships every language service in the tarball, but the AMD loader only
    requests them when a document of that language is opened. Dropping the ones
    this plugin never maps to (typescript, css) and the translation bundles cuts
    the payload from ~13 MB to ~5 MB without changing behaviour.
#>
[CmdletBinding()]
param(
    [string] $MonacoVersion = '0.52.2',
    [string] $MarkedVersion = '15.0.6',
    [string] $TurndownVersion = '7.2.1',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir   = Join-Path $repoRoot 'web'
$vsDir    = Join-Path $webDir 'vs'
$stampFile = Join-Path $vsDir '.version'
$stamp = "monaco=$MonacoVersion marked=$MarkedVersion turndown=$TurndownVersion"

if (-not $Force -and (Test-Path $stampFile) -and ((Get-Content $stampFile -Raw).Trim() -eq $stamp)) {
    Write-Host "Monaco $MonacoVersion already present in web\vs (use -Force to refresh)."
    exit 0
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("monaco-fetch-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

try {
    $tgz = Join-Path $work 'monaco.tgz'
    Write-Host "Downloading monaco-editor@$MonacoVersion ..."
    Invoke-WebRequest -Uri "https://registry.npmjs.org/monaco-editor/-/monaco-editor-$MonacoVersion.tgz" `
                      -OutFile $tgz -UseBasicParsing

    Write-Host 'Extracting ...'
    & tar -xzf $tgz -C $work
    if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }

    $src = Join-Path $work 'package\min\vs'
    if (-not (Test-Path $src)) { throw "min/vs not found in the monaco-editor tarball" }

    # Language services the plugin never activates. Removing them is safe because
    # editor.main.js only require()s these paths when such a file is opened.
    foreach ($drop in 'language\typescript', 'language\css') {
        $p = Join-Path $src $drop
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
    }
    # Localisation bundles are only fetched when a locale is configured; we never do.
    Get-ChildItem $src -Filter 'nls.messages.*.js' -File | Remove-Item -Force

    if (Test-Path $vsDir) { Remove-Item $vsDir -Recurse -Force }
    New-Item -ItemType Directory -Path $webDir -Force | Out-Null
    Copy-Item $src $vsDir -Recurse

    Write-Host "Downloading marked@$MarkedVersion ..."
    Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/marked@$MarkedVersion/marked.min.js" `
                      -OutFile (Join-Path $webDir 'marked.min.js') -UseBasicParsing

    Write-Host "Downloading turndown@$TurndownVersion ..."
    Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/turndown@$TurndownVersion/dist/turndown.js" `
                      -OutFile (Join-Path $webDir 'turndown.min.js') -UseBasicParsing

    Set-Content -Path $stampFile -Value $stamp -Encoding ASCII

    $size = (Get-ChildItem $vsDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
    Write-Host ("Done. web\vs = {0:N1} MB" -f ($size / 1MB))
}
finally {
    if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
