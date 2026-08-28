# Captures BSLEdit and wlxhost screenshots for README / GitHub release.
param(
    [string] $OutDir = ""
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."
if (-not $OutDir) { $OutDir = Join-Path $root 'screens' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CapWin {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

function Capture-Hwnd([IntPtr] $h, [string] $outFile) {
    [void][CapWin]::ShowWindow($h, 9) # SW_RESTORE
    [void][CapWin]::SetWindowPos($h, [IntPtr]::Zero, 80, 40, 1200, 800, 0x0040)
    [void][CapWin]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 800

    $r = New-Object CapWin+RECT
    [void][CapWin]::GetWindowRect($h, [ref]$r)
    $w = $r.R - $r.L
    $ht = $r.B - $r.T
    if ($w -lt 200 -or $ht -lt 200) { throw "Window too small: ${w}x${ht}" }

    $bmp = New-Object System.Drawing.Bitmap $w, $ht
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [void][CapWin]::PrintWindow($h, $hdc, 2)
    $g.ReleaseHdc($hdc)
    $g.Dispose()
    $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Saved $outFile ($w x $ht)"
}

function Wait-MainWindow([System.Diagnostics.Process] $proc, [int] $timeoutMs = 25000, [string] $titleLike = '*') {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
        $proc.Refresh()
        if ($proc.HasExited) { throw "Process $($proc.Id) exited before a window appeared" }
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero -and $proc.MainWindowTitle -like $titleLike) {
            return $proc.MainWindowHandle
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for window of pid $($proc.Id) (title='$($proc.MainWindowTitle)')"
}

function Wait-NamedWindow([string] $className, [string] $title, [int] $timeoutMs = 25000) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = New-Object CapWin+RECT
    while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
        $h = [CapWin]::FindWindow($className, $title)
        if ($h -ne [IntPtr]::Zero) {
            [void][CapWin]::GetWindowRect($h, [ref]$r)
            if (($r.R - $r.L) -ge 400 -and ($r.B - $r.T) -ge 300) { return $h }
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for window '$title' ($className)"
}

function Invoke-BSLEditShot([string] $file, [string] $outName, [int] $settleMs = 4500) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Sample missing: $file" }
    Get-Process BSLEdit -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 300
    $exe = Join-Path $root 'BSLEdit.exe'
    Write-Host "BSLEdit $file"
    $p = Start-Process $exe -ArgumentList $file -PassThru
    # Real editor title is "BSL Editor - filename". The read-error MessageBox
    # is also titled "BSL Editor" and must not be captured.
    $h = Wait-MainWindow $p 25000 'BSL Editor - *'
    Start-Sleep -Milliseconds $settleMs
    $p.Refresh()
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $h = $p.MainWindowHandle }
    Capture-Hwnd $h (Join-Path $OutDir $outName)
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}

function Invoke-ViewerShot([string] $plugin, [string] $hostExe, [string] $file, [string] $outName, [int] $settleMs = 5500) {
    if (-not (Test-Path -LiteralPath $file)) { throw "Sample missing: $file" }
    Get-Process wlxhost -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 300
    Write-Host "wlxhost $file"
    $p = Start-Process $hostExe -ArgumentList @($plugin, $file, $file, '800', '30000') -PassThru
    $h = Wait-NamedWindow 'WlxHostWnd' 'WLX Host'
    Start-Sleep -Milliseconds $settleMs
    if ($p.HasExited) { throw "wlxhost exited early (code $($p.ExitCode)) for $file" }
    Capture-Hwnd $h (Join-Path $OutDir $outName)
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}

$td = Join-Path $root 'testdata'
$plugin = Join-Path $root 'BSLView.wlx64'
$hostExe = Join-Path $root 'objtest\wlxhost.exe'
if (-not (Test-Path $plugin)) { throw "Plugin not found: $plugin" }
if (-not (Test-Path $hostExe)) { throw "wlxhost not found: $hostExe" }

function Get-Sample([string] $ext) {
    $hit = Get-ChildItem -LiteralPath $td -File | Where-Object {
        $_.Extension -ieq $ext -and $_.Name -notlike 'scroll*'
    } | Select-Object -First 1
    if (-not $hit) { throw "No *$ext sample in $td" }
    return $hit.FullName
}

$sampleBsl  = Get-Sample '.bsl'
$sampleMd   = Get-Sample '.md'
$sampleJson = Get-Sample '.json'
$sampleXml  = Get-Sample '.xml'

Write-Host '=== BSLEdit ==='
Invoke-BSLEditShot $sampleBsl  'bsledit-bsl.png'
Invoke-BSLEditShot $sampleMd   'bsledit-md.png'  6000
Invoke-BSLEditShot $sampleJson 'bsledit-json.png'
Invoke-BSLEditShot $sampleXml  'bsledit-xml.png'

Write-Host '=== Viewer (wlxhost) ==='
Invoke-ViewerShot $plugin $hostExe $sampleBsl  'viewer-bsl.png'
Invoke-ViewerShot $plugin $hostExe $sampleMd   'viewer-md.png'  6500
Invoke-ViewerShot $plugin $hostExe $sampleJson 'viewer-json.png'
Invoke-ViewerShot $plugin $hostExe $sampleXml  'viewer-xml.png'

Write-Host 'Done.'
Get-ChildItem $OutDir -Filter *.png | Format-Table Name, Length
