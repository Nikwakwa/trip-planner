# Tiny local web server for testing the app on this computer.
# Usage (in PowerShell, from this folder):   .\serve.ps1
# Then open http://localhost:8080 in Chrome. Press Ctrl+C to stop.
# -MaxAge 600 mimics GitHub Pages, which lets browsers reuse files for 10 minutes.
param([int]$Port = 8080, [int]$MaxAge = 0)

$root = [IO.Path]::GetFullPath($PSScriptRoot)
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'
  '.json' = 'application/json'
  '.png' = 'image/png'
  '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    # Wait in short slices so Ctrl+C can interrupt.
    while (-not $task.AsyncWaitHandle.WaitOne(500)) { }
    $ctx = $task.GetAwaiter().GetResult()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    $res = $ctx.Response
    if ($full.StartsWith($root) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = $types[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $res.ContentType = $type
      $res.Headers.Add('Cache-Control', $(if ($MaxAge) { "max-age=$MaxAge" } else { 'no-cache' }))
      $res.ContentLength64 = $bytes.Length
      # HEAD requests (some tools send them to check the server is up) get headers only.
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
    Write-Host "$($ctx.Request.HttpMethod) /$rel -> $($res.StatusCode)"
  }
} finally {
  $listener.Stop()
}
