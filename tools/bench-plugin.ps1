# Drives the .wlx64 through wlxhost.exe and measures how long after ListLoad the
# editor actually paints. The warm-up window is subtracted, so the reported
# number is what a user waits for after pressing F3.
param(
    [int] $WarmupMs = 3000,
    [int] $TimeoutMs = 60000,
    [switch] $Cold
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PlugWin {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

$root = Resolve-Path "$PSScriptRoot\.."
Get-Process wlxhost, BSLEdit -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if ($Cold) {
    Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force
    $cache = "$env:LOCALAPPDATA\BSLView\WebView2"
    if (Test-Path $cache) { Remove-Item $cache -Recurse -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

$small = (Get-ChildItem "$root\testdata" -Filter *.bsl | Sort-Object Length | Select-Object -First 1).FullName
$plugin = "$root\BSLView.wlx64"

$sw = [Diagnostics.Stopwatch]::StartNew()
# Not minimized on purpose: WebView2 stops rendering when the window is occluded.
$p = Start-Process "$root\objtest\wlxhost.exe" -ArgumentList @("`"$plugin`"", "`"$small`"", "`"$small`"", $WarmupMs, 8000) -PassThru

$painted = $null
$raised = $false
$bmp = $null
$g = $null
while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    $p.Refresh()
    if ($p.HasExited) { break }
    $h = $p.MainWindowHandle
    if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 10; continue }
    if (-not $raised) {
        # WebView2 throttles rendering for occluded windows, which would show up
        # as inflated paint times.
        [void][PlugWin]::BringWindowToTop($h)
        [void][PlugWin]::SetForegroundWindow($h)
        $raised = $true
    }

    $r = New-Object PlugWin+RECT
    [void][PlugWin]::GetWindowRect($h, [ref]$r)
    if (($r.R - $r.L) -lt 400) { Start-Sleep -Milliseconds 10; continue }

    # Grab a small strip straight off the screen. A full-window PrintWindow plus
    # per-pixel reads costs more than the latency being measured.
    if (-not $bmp) {
        $bmp = New-Object System.Drawing.Bitmap 300, 120
        $g = [System.Drawing.Graphics]::FromImage($bmp)
    }
    $g.CopyFromScreen(($r.L + 80), ($r.T + 70), 0, 0, (New-Object System.Drawing.Size 300, 120))

    $colors = @{}
    for ($x = 0; $x -lt 300; $x += 25) {
        for ($y = 0; $y -lt 120; $y += 15) { $colors[$bmp.GetPixel($x, $y).ToArgb()] = 1 }
    }
    if ($colors.Count -ge 6) { $painted = $sw.ElapsedMilliseconds; break }
}
$sw.Stop()
if ($g) { $g.Dispose() }
if ($bmp) { $bmp.Dispose() }

$label = if ($Cold) { 'COLD' } else { 'WARM' }
if ($painted) {
    "{0,-6} paint {1,5} ms after ListLoad  (total {2} ms incl. {3} ms warm-up)" -f `
        $label, [Math]::Max(0, $painted - $WarmupMs), $painted, $WarmupMs
} else {
    "{0,-6} not detected within {1} ms" -f $label, $sw.ElapsedMilliseconds
}

Get-Process wlxhost -ErrorAction SilentlyContinue | Stop-Process -Force
