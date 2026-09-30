# Downloads the Google Sans Flex font and Material Symbols icons into the app,
# so they are stored locally and work offline.   Run:  .\tools\fetch-assets.ps1
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'

# ---- Font (latin subset, variable weight + optical size + roundness) ----
$ua = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
$css = (Invoke-WebRequest 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght,ROND@6..144,300..800,0..100&display=swap' -UserAgent $ua -UseBasicParsing).Content
$latin = ($css -split '/\* latin \*/')[-1]
$url = [regex]::Match($latin, 'url\((https://[^)]+\.woff2)\)').Groups[1].Value
New-Item -ItemType Directory -Force (Join-Path $root 'fonts') | Out-Null
Invoke-WebRequest $url -OutFile (Join-Path $root 'fonts/google-sans-flex.woff2') -UseBasicParsing
Write-Host "Font saved."

# ---- Icons (Material Symbols Rounded) -> one sprite file ----
$outline = 'calendar_month','lightbulb','checklist','settings','add','edit','location_on','link','close','check',
  'delete','schedule','download','upload','install_mobile','cloud_off','offline_pin','restart_alt','luggage',
  'travel_explore','today','event_available','palette','shield','arrow_forward','calendar_add_on','flight_takeoff',
  'directions_walk','directions_subway','auto_awesome','shuffle','explore','light_mode','dark_mode','brightness_auto',
  'near_me','bedtime','wb_sunny','umbrella','money_off','map','open_in_new',
  'route','directions','share','pin_drop','location_off',
  'login','logout','sync','cloud_done','person','search','public','directions_car','error','visibility','visibility_off',
  'sunny','partly_cloudy_day','cloud','foggy','rainy','weather_snowy','thunderstorm','water_drop',
  'info','emergency','call','translate','payments','power','handshake','directions_bus','health_and_safety','wifi',
  'event_busy','drag_indicator'
$filled = 'calendar_month','lightbulb','checklist','settings',
  'museum','restaurant','local_activity','shopping_bag','train','hotel','push_pin','location_on','luggage'

$base = 'https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web'
$symbols = foreach ($set in @(@{ names = $outline; suffix = ''; id = '' }, @{ names = $filled; suffix = '_fill1'; id = '-fill' })) {
  foreach ($n in $set.names) {
    $svg = (Invoke-WebRequest "$base/$n/materialsymbolsrounded/$n$($set.suffix)_24px.svg" -UseBasicParsing).Content
    $d = [regex]::Match($svg, ' d="([^"]+)"').Groups[1].Value
    $vb = [regex]::Match($svg, 'viewBox="([^"]+)"').Groups[1].Value
    if (-not $vb) { $vb = "0 0 $([regex]::Match($svg, 'width="(\d+)"').Groups[1].Value) $([regex]::Match($svg, 'height="(\d+)"').Groups[1].Value)" }
    "  <symbol id=`"$n$($set.id)`" viewBox=`"$vb`"><path d=`"$d`"/></symbol>"
  }
}
$sprite = "<svg xmlns=`"http://www.w3.org/2000/svg`">`n" + ($symbols -join "`n") + "`n</svg>`n"
[IO.File]::WriteAllText((Join-Path $root 'icons/sprite.svg'), $sprite)
Write-Host "Icons saved: $($symbols.Count)"

# ---- Firebase (login + sync between phones), "compat" builds that work as plain scripts ----
$fbVersion = '12.19.0'
New-Item -ItemType Directory -Force (Join-Path $root 'vendor/firebase') | Out-Null
foreach ($part in 'app', 'auth', 'firestore') {
  Invoke-WebRequest "https://www.gstatic.com/firebasejs/$fbVersion/firebase-$part-compat.js" -OutFile (Join-Path $root "vendor/firebase/firebase-$part-compat.js") -UseBasicParsing
}
Write-Host "Firebase $fbVersion saved."
