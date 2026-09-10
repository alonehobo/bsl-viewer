param(
  [string]$NodeVersion = '24.13.0'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$runtime = Join-Path $root 'runtime'
$app = Join-Path $root 'app'
$node = Join-Path $runtime 'node.exe'

if (-not (Test-Path -LiteralPath $node)) {
  $archiveName = "node-v$NodeVersion-win-x64.zip"
  $download = Join-Path ([IO.Path]::GetTempPath()) $archiveName
  $url = "https://nodejs.org/dist/v$NodeVersion/$archiveName"
  Write-Host "Downloading Node.js $NodeVersion..."
  Invoke-WebRequest -Uri $url -OutFile $download
  $extract = Join-Path ([IO.Path]::GetTempPath()) ("1c-form-viewer-node-" + [guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $download -DestinationPath $extract -Force
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $extract "node-v$NodeVersion-win-x64\*") -Destination $runtime -Recurse -Force
  Remove-Item -LiteralPath $extract,$download -Recurse -Force
}

$npm = Join-Path $runtime 'npm.cmd'
if (-not (Test-Path -LiteralPath $npm)) { throw "Node runtime is incomplete: $runtime" }
Write-Host 'Installing MCP production dependencies...'
Push-Location $app
try {
  & $npm install --omit=dev --ignore-scripts --no-package-lock
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
finally {
  Pop-Location
}
Write-Host '1c-form-viewer is ready.'
