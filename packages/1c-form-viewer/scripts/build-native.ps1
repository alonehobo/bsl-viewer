param(
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $packageRoot '..\..')).Path
$Output = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $repoRoot 'artifacts\1c-form-viewer-native-win-x64' } else { $Output }

Remove-Item -LiteralPath $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Output -Force | Out-Null
# Callers pass relative paths (the VS Code extension builds into ./mcp) and the
# compile below runs with $Output as the working directory, so anything derived
# from it has to be absolute first.
$Output = (Resolve-Path -LiteralPath $Output).Path
$app = Join-Path $Output 'app'
New-Item -ItemType Directory -Path (Join-Path $app 'web') -Force | Out-Null

Push-Location $packageRoot
try {
  npm run prepack
  if ($LASTEXITCODE -ne 0) { throw 'Package build failed.' }
}
finally {
  Pop-Location
}

Copy-Item -Path (Join-Path $packageRoot 'dist\web\*') -Destination (Join-Path $app 'web') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $packageRoot 'README.md') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'LICENSE') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'native\NATIVE-README.md') -Destination (Join-Path $Output 'README.md')

. "$PSScriptRoot/msvc-env.ps1"
$cl = Initialize-MsvcEnvironment

# The native server's version comes from package.json, same as the Node one.
# It is force-included below so a release bumps a single file.
$version = (Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($version)) { throw 'package.json has no version.' }
$versionHeader = Join-Path $Output 'native-version.h'
Set-Content -LiteralPath $versionHeader -Encoding ASCII -Value "#define ONE_C_FORM_VIEWER_VERSION `"$version`""

$source = Join-Path $packageRoot 'native\mcp-server.cpp'
Push-Location $Output
try {
  & $cl /nologo /O2 /MT /std:c++17 /EHsc /W3 /DUNICODE /D_UNICODE /D_CRT_SECURE_NO_WARNINGS /FI"$versionHeader" $source /Fe:1c-form-viewer.exe /link /SUBSYSTEM:CONSOLE shell32.lib ws2_32.lib
  if ($LASTEXITCODE -ne 0) { throw 'Native MCP server build failed.' }
}
finally {
  # Also on a failed link, or the object file and the generated header stay
  # behind in the artifact directory and end up in the next package.
  Pop-Location
  Remove-Item -LiteralPath (Join-Path $Output 'mcp-server.obj') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $versionHeader -Force -ErrorAction SilentlyContinue
}

Write-Output $Output
