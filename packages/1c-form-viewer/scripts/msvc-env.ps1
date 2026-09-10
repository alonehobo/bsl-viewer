# Locates an x64 MSVC toolchain and a Windows SDK, then puts cl.exe, its
# headers and its libraries on the environment.
#
# The three build scripts used to hardcode a single toolset and SDK build
# number, so a Visual Studio update broke the release. vswhere is the supported
# way to ask where the toolchain actually is; the literal paths below stay only
# as a last resort for a machine without it.
#
# Dot-source it: . "$PSScriptRoot\msvc-env.ps1"; Initialize-MsvcEnvironment
# It returns the path to cl.exe and also sets $script:MsvcRc for callers that
# need the resource compiler.

Set-StrictMode -Version Latest

function Get-MsvcToolsetDirectory {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  $roots = @()
  if (Test-Path -LiteralPath $vswhere) {
    $roots = & $vswhere -products '*' -latest -prerelease `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath 2>$null
  }
  if (-not $roots) {
    $roots = @(
      'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools',
      'C:\Program Files\Microsoft Visual Studio\2022\Community',
      'C:\Program Files\Microsoft Visual Studio\2022\Professional',
      'C:\Program Files\Microsoft Visual Studio\2022\Enterprise'
    ) | Where-Object { Test-Path -LiteralPath $_ }
  }
  foreach ($root in $roots) {
    $toolsetRoot = Join-Path $root 'VC\Tools\MSVC'
    if (-not (Test-Path -LiteralPath $toolsetRoot)) { continue }
    # Highest toolset version wins, so a VS update is picked up on its own.
    $toolset = Get-ChildItem -LiteralPath $toolsetRoot -Directory |
      Sort-Object { [version]$_.Name } -Descending |
      Select-Object -First 1
    if ($toolset -and (Test-Path -LiteralPath (Join-Path $toolset.FullName 'bin\Hostx64\x64\cl.exe'))) {
      return $toolset.FullName
    }
  }
  throw 'No x64 MSVC toolchain found. Install the "Desktop development with C++" workload.'
}

function Get-WindowsSdkVersion {
  param([string]$WindowsKit)

  $includeRoot = Join-Path $WindowsKit 'Include'
  if (-not (Test-Path -LiteralPath $includeRoot)) { throw "Windows SDK not found at $WindowsKit" }
  $version = Get-ChildItem -LiteralPath $includeRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'um\windows.h') } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
  if (-not $version) { throw "No usable Windows SDK under $includeRoot" }
  return $version.Name
}

function Initialize-MsvcEnvironment {
  $msvc = Get-MsvcToolsetDirectory
  $windowsKit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
  $sdkVersion = Get-WindowsSdkVersion -WindowsKit $windowsKit

  $env:Path = "$(Join-Path $msvc 'bin\Hostx64\x64');$env:Path"
  $env:INCLUDE = @(
    (Join-Path $msvc 'include'),
    (Join-Path $windowsKit "Include\$sdkVersion\ucrt"),
    (Join-Path $windowsKit "Include\$sdkVersion\um"),
    (Join-Path $windowsKit "Include\$sdkVersion\shared")
  ) -join ';'
  $env:LIB = @(
    (Join-Path $msvc 'lib\x64'),
    (Join-Path $windowsKit "Lib\$sdkVersion\ucrt\x64"),
    (Join-Path $windowsKit "Lib\$sdkVersion\um\x64")
  ) -join ';'

  $script:MsvcRc = Join-Path $windowsKit "bin\$sdkVersion\x64\rc.exe"
  Write-Verbose "MSVC $(Split-Path $msvc -Leaf), Windows SDK $sdkVersion"
  return (Join-Path $msvc 'bin\Hostx64\x64\cl.exe')
}
