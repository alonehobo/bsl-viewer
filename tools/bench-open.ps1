# Measures wall-clock time from launching BSLEdit.exe until the editor surface
# has actually painted, by polling the window for the editor background colour.
param(
    [string] $File,
    [switch] $Cold,
    [int]    $TimeoutMs = 60000
)

$ErrorActionPreference = 'Stop'

if (-not $File) {
    # Resolved rather than hard-coded: the sample file has a Cyrillic name and
    # Windows PowerShell reads BOM-less .ps1 files as ANSI.
    $File = (Get-ChildItem "$PSScriptRoot\..\testdata" -Filter *.bsl | Select-Object -First 1).FullName
}
if (-not $File -or -not (Test-Path -LiteralPath $File)) { throw "No test file found" }
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BenchWin {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

Get-Process BSLEdit -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if ($Cold) {
    $cache = "$env:LOCALAPPDATA\BSLView\WebView2"
    if (Test-Path $cache) { Remove-Item $cache -Recurse -Force -ErrorAction SilentlyContinue }
    Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

$exe = Resolve-Path "$PSScriptRoot\..\BSLEdit.exe"
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $exe -ArgumentList "`"$File`"" -PassThru

$painted = $false
$windowAt = $null
while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    $p.Refresh()
    if ($p.HasExited) { throw "BSLEdit exited early (code $($p.ExitCode))" }
    $h = $p.MainWindowHandle
    if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 10; continue }
    if (-not $windowAt) { $windowAt = $sw.ElapsedMilliseconds }

    $r = New-Object BenchWin+RECT
    [void][BenchWin]::GetClientRect($h, [ref]$r)
    if (($r.R - $r.L) -lt 400) { Start-Sleep -Milliseconds 10; continue }

    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [void][BenchWin]::PrintWindow($h, $hdc, 2)
    $g.ReleaseHdc($hdc); $g.Dispose()

    # Sample a sparse grid over the code area. While the loader placeholder is
    # up the page is a flat colour; once Monaco paints, glyphs make it vary.
    # Kept sparse on purpose: GetPixel from PowerShell is slow enough to skew
    # the very measurement we are taking.
    $colors = @{}
    for ($x = 60; $x -lt 420; $x += 20) {
        for ($y = 40; $y -lt 200; $y += 10) {
            $colors[$bmp.GetPixel($x, $y).ToArgb()] = 1
        }
    }
    $bmp.Dispose()
    if ($colors.Count -ge 6) { $painted = $true; break }
}
$sw.Stop()

$label = if ($Cold) { 'COLD' } else { 'WARM' }
if ($painted) {
    "{0,-6} window: {1,5} ms   editor painted: {2,6} ms" -f $label, $windowAt, $sw.ElapsedMilliseconds
} else {
    "{0,-6} TIMED OUT after {1} ms" -f $label, $sw.ElapsedMilliseconds
}

Start-Sleep -Milliseconds 300
Get-Process BSLEdit -ErrorAction SilentlyContinue | Stop-Process -Force
