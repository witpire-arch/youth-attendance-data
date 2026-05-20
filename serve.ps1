# Minimal static file server for C:\project on http://localhost:8080
# Run from C:\project. Stop with Ctrl+C (or kill the background process).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:SERVE_PORT) { [int]$env:SERVE_PORT } else { 8080 }
$prefix = "http://localhost:$port/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $root at $prefix"
Write-Host "Press Ctrl+C to stop."

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.map'  = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $url = $req.Url.LocalPath
      if ([string]::IsNullOrEmpty($url) -or $url -eq '/') { $url = '/index.html' }
      # Normalize and prevent path traversal
      $relative = [Uri]::UnescapeDataString($url.TrimStart('/'))
      $relative = $relative -replace '/', '\'
      $path = Join-Path $root $relative
      $full = [IO.Path]::GetFullPath($path)
      if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
        $bytes = [Text.Encoding]::UTF8.GetBytes('403 Forbidden')
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } elseif (Test-Path -LiteralPath $full -PathType Container) {
        $idx = Join-Path $full 'index.html'
        if (Test-Path -LiteralPath $idx) { $full = $idx } else { $res.StatusCode = 404 }
      }
      if ($res.StatusCode -ne 403 -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.ContentType = $ct
        $bytes = [IO.File]::ReadAllBytes($full)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host "$($req.HttpMethod) $url -> 200 ($($bytes.Length) bytes)"
      } elseif ($res.StatusCode -ne 403) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $url")
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host "$($req.HttpMethod) $url -> 404"
      }
    } catch {
      $res.StatusCode = 500
      $msg = "500 Server Error: $($_.Exception.Message)"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      try { $res.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
      Write-Host "Error: $($_.Exception.Message)"
    } finally {
      try { $res.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
