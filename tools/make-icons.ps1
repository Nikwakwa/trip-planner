# Draws the app's logo and icons into ../icons.   Run from anywhere:   .\tools\make-icons.ps1
# The logo: a golden sun in the app's scalloped "cookie" shape on a deep blue sky, crossed by a
# dotted route from a starting point to a destination ring - a day of the trip, planned.
# It is written as a vector file (logo.svg), then turned into PNG icons with Microsoft Edge.
$ErrorActionPreference = 'Stop'
$out = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\icons'))
New-Item -ItemType Directory -Force $out | Out-Null
$inv = [Globalization.CultureInfo]::InvariantCulture

# The scalloped outline: a circle whose radius gently waves ($lobes times around).
function Get-Cookie([double]$cx, [double]$cy, [double]$r, [int]$lobes, [double]$depth) {
  $n = 240
  $pts = for ($i = 0; $i -lt $n; $i++) {
    $a = ($i / $n) * 2 * [Math]::PI - [Math]::PI / 2
    $rr = $r * (1 + $depth * [Math]::Cos($lobes * $a))
    [string]::Format($inv, '{0:0.0} {1:0.0}', ($cx + $rr * [Math]::Cos($a)), ($cy + $rr * [Math]::Sin($a)))
  }
  'M' + ($pts -join 'L') + 'Z'
}

# $scale: size of the sun (1 = normal; smaller for "maskable" icons, which Android crops into circles).
# $corner: rounded corners of the background, 0 for a full square.
function Get-LogoSvg([double]$scale, [double]$corner, [int]$size = 512) {
  $cookie = Get-Cookie 256 256 172 10 0.07
  $t = [string]::Format($inv, 'translate(256 256) scale({0}) translate(-256 -256)', $scale)
  @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="$size" height="$size">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4763F5"/><stop offset="1" stop-color="#151E63"/>
    </linearGradient>
    <linearGradient id="sun" x1="0.15" y1="0.1" x2="0.85" y2="0.95">
      <stop offset="0" stop-color="#FFE27A"/><stop offset="1" stop-color="#FF9A2E"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="$($corner.ToString($inv))" fill="url(#sky)"/>
  <g transform="$t">
    <path d="$cookie" fill="url(#sun)"/>
    <g fill="none" stroke="#1A2470" stroke-linecap="round">
      <path d="M184 330 C 196 236, 322 300, 322 204" stroke-width="23" stroke-dasharray="0.1 36"/>
      <circle cx="324" cy="184" r="28" stroke-width="20"/>
    </g>
    <circle cx="184" cy="332" r="21" fill="#1A2470"/>
  </g>
</svg>
"@
}

# The vector logo itself (rounded corners), also used as the browser tab icon.
$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $out 'logo.svg'), (Get-LogoSvg 1 112), $utf8)

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge is needed to turn the logo into PNG icons.' }

function New-Icon([int]$size, [double]$scale, [double]$corner, [string]$name) {
  $tmp = Join-Path $env:TEMP "trip-planner-icon-$size-$name.html"
  $svg = Get-LogoSvg $scale $corner $size
  [IO.File]::WriteAllText($tmp, "<!doctype html><html><body style=`"margin:0;background:transparent;overflow:hidden`">$svg</body></html>", $utf8)
  $png = Join-Path $out $name
  $profile = Join-Path $env:TEMP 'trip-planner-icon-profile'
  # Edge prints harmless warnings: its messages are ignored, the PNG file is what counts.
  $edgeArgs = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', "--user-data-dir=`"$profile`"",
    '--default-background-color=00000000', "--window-size=$size,$size", "--screenshot=`"$png`"", "`"file:///$($tmp.Replace([char]92, [char]47))`"")
  Start-Process -FilePath $edge -ArgumentList $edgeArgs -Wait -WindowStyle Hidden -RedirectStandardError (Join-Path $env:TEMP 'trip-planner-icon-edge.log')
  Start-Sleep -Milliseconds 300
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if (-not (Test-Path $png)) { throw "Could not write $name" }
}

New-Icon 192 1   112 'icon-192.png'
New-Icon 512 1   112 'icon-512.png'
New-Icon 512 0.84  0 'icon-maskable-512.png'   # full square, smaller sun: Android crops these into circles etc.
New-Icon 180 0.92  0 'apple-touch-icon.png'    # iOS rounds the corners itself
Write-Host "Logo and icons written to $out"
