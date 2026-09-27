# Draws the app icons (a white map pin on a colored square) into ../icons.
# Run from anywhere:   .\tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null
$bg = [System.Drawing.ColorTranslator]::FromHtml('#c62828')

function New-Icon([int]$size, [double]$scale, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear($bg)

  # Pin geometry, in 0..1 units, shrunk by $scale around the center.
  $s = $size * $scale
  $ox = ($size - $s) / 2
  $oy = ($size - $s) / 2
  $cx = $ox + 0.5 * $s; $cy = $oy + 0.40 * $s; $r = 0.24 * $s

  $white = [System.Drawing.Brushes]::White
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc([single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r), 150, 240)
  $path.AddLine([single]($cx + $r * [Math]::Cos(30 * [Math]::PI / 180)), [single]($cy + $r * 0.5),
                [single]$cx, [single]($oy + 0.86 * $s))
  $path.CloseFigure()
  $g.FillPath($white, $path)

  $hole = 0.095 * $s
  $bgBrush = New-Object System.Drawing.SolidBrush $bg
  $g.FillEllipse($bgBrush, [single]($cx - $hole), [single]($cy - $hole), [single](2 * $hole), [single](2 * $hole))

  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 0.80 'icon-192.png'
New-Icon 512 0.80 'icon-512.png'
New-Icon 512 0.62 'icon-maskable-512.png'   # extra padding: Android crops these into circles etc.
New-Icon 180 0.80 'apple-touch-icon.png'
Write-Host "Icons written to $out"
