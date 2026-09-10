param(
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $packageRoot '..\..')).Path
$Output = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $repoRoot 'artifacts\1c-form-viewer-compact-win-x64' } else { $Output }
$launcherSource = Join-Path $packageRoot 'native\launcher.cpp'

Remove-Item -LiteralPath $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Output -Force | Out-Null
$app = Join-Path $Output 'app'
New-Item -ItemType Directory -Path $app -Force | Out-Null

Push-Location $packageRoot
try {
  npm run prepack
  if ($LASTEXITCODE -ne 0) { throw 'Package build failed.' }
}
finally {
  Pop-Location
}

Copy-Item -LiteralPath (Join-Path $packageRoot 'dist') -Destination $app -Recurse
Copy-Item -LiteralPath (Join-Path $packageRoot 'package.json') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'README.md') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'LICENSE') -Destination $app
Copy-Item -LiteralPath (Join-Path $packageRoot 'native\install.ps1') -Destination $Output
Copy-Item -LiteralPath (Join-Path $packageRoot 'native\COMPACT-README.md') -Destination (Join-Path $Output 'README.md')

. "$PSScriptRoot/msvc-env.ps1"
$cl = Initialize-MsvcEnvironment

Push-Location $Output
try {
  & $cl /nologo /O2 /MT /std:c++17 /EHsc /W3 /DUNICODE /D_UNICODE /D_CRT_SECURE_NO_WARNINGS $launcherSource /Fe:1c-form-viewer.exe /link /SUBSYSTEM:CONSOLE shell32.lib
  if ($LASTEXITCODE -ne 0) { throw 'Compact launcher build failed.' }
}
finally {
  Pop-Location
}

Remove-Item -LiteralPath (Join-Path $Output 'launcher.obj') -Force -ErrorAction SilentlyContinue
Write-Output $Output
