param(
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $packageRoot '..\..')).Path
$Output = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $repoRoot 'artifacts\1c-form-viewer-win-x64' } else { $Output }
$launcherSource = Join-Path $packageRoot 'native\launcher.cpp'
$nodeSource = (Get-Command node).Source

if (-not (Test-Path -LiteralPath $launcherSource)) { throw "Missing launcher source: $launcherSource" }
if (-not (Test-Path -LiteralPath $nodeSource)) { throw "Missing Node runtime: $nodeSource" }

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
Copy-Item -LiteralPath (Join-Path $packageRoot 'native\PORTABLE-README.md') -Destination (Join-Path $Output 'README.md')
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $Output 'node.exe')

$dependencySources = @(
  @{ Source = Join-Path $repoRoot 'node_modules\@modelcontextprotocol\server'; Destination = Join-Path $app 'node_modules\@modelcontextprotocol\server' },
  @{ Source = Join-Path $repoRoot 'node_modules\@modelcontextprotocol\core'; Destination = Join-Path $app 'node_modules\@modelcontextprotocol\core' },
  @{ Source = Join-Path $repoRoot 'node_modules\playwright-core'; Destination = Join-Path $app 'node_modules\playwright-core' },
  @{ Source = Join-Path $repoRoot 'node_modules\zod'; Destination = Join-Path $app 'node_modules\zod' }
)
foreach ($dependency in $dependencySources) {
  if (-not (Test-Path -LiteralPath $dependency.Source)) { throw "Missing production dependency: $($dependency.Source)" }
  New-Item -ItemType Directory -Path (Split-Path -Parent $dependency.Destination) -Force | Out-Null
  Copy-Item -LiteralPath $dependency.Source -Destination $dependency.Destination -Recurse
}

. "$PSScriptRoot/msvc-env.ps1"
$cl = Initialize-MsvcEnvironment
$rc = $script:MsvcRc

Push-Location $Output
try {
  & $cl /nologo /O2 /MT /std:c++17 /EHsc /W3 /DUNICODE /D_UNICODE /D_CRT_SECURE_NO_WARNINGS $launcherSource /Fe:1c-form-viewer.exe /link /SUBSYSTEM:CONSOLE shell32.lib
  if ($LASTEXITCODE -ne 0) { throw 'Portable launcher build failed.' }
}
finally {
  Pop-Location
}

Remove-Item -LiteralPath (Join-Path $Output 'launcher.obj') -Force -ErrorAction SilentlyContinue
Write-Output $Output
