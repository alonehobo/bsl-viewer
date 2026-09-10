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

$msvc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207'
$windowsKit = 'C:\Program Files (x86)\Windows Kits\10'
$sdkVersion = '10.0.26100.0'
$cl = Join-Path $msvc 'bin\Hostx64\x64\cl.exe'
if (-not (Test-Path -LiteralPath $cl)) { throw "MSVC compiler not found: $cl" }

$env:Path = "$(Join-Path $msvc 'bin\Hostx64\x64');$env:Path"
$env:INCLUDE = "$(Join-Path $msvc 'include');$(Join-Path $windowsKit "Include\$sdkVersion\ucrt");$(Join-Path $windowsKit "Include\$sdkVersion\um");$(Join-Path $windowsKit "Include\$sdkVersion\shared")"
$env:LIB = "$(Join-Path $msvc 'lib\x64');$(Join-Path $windowsKit "Lib\$sdkVersion\ucrt\x64");$(Join-Path $windowsKit "Lib\$sdkVersion\um\x64")"

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
