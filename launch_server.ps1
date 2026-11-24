# BeamStudio 3D — Zero-Dependency Local HTTP Server + Optional AI CORS Proxy
# Runs using Windows built-in PowerShell (.NET HttpListener) — no Node.js or Python needed!
param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Prefix = "http://localhost:$Port/"

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Prefix)
$Listener.Start()

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "  BeamStudio 3D running at $Prefix" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C in this window to stop the server." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

if (-not $NoBrowser) {
    Start-Process $Prefix
}

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".ico"  = "image/x-icon"
}

try {
    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response
        $Path = $Request.Url.AbsolutePath

        try {
            # Optional local AI CORS proxy endpoint (/api/ai-proxy)
            if ($Path -eq "/api/ai-proxy" -and $Request.HttpMethod -eq "POST") {
                $Reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
                $BodyText = $Reader.ReadToEnd()
                $BodyJson = $BodyText | ConvertFrom-Json

                $Headers = @{}
                foreach ($p in $BodyJson.headers.PSObject.Properties) {
                    if ($p.Name -ne "Content-Type") {
                        $Headers[$p.Name] = $p.Value
                    }
                }
                $PayloadStr = $BodyJson.payload | ConvertTo-Json -Depth 16 -Compress
                $ApiResp = Invoke-WebRequest -Uri $BodyJson.url -Method Post -Headers $Headers -ContentType "application/json" -Body $PayloadStr -UseBasicParsing
                $Bytes = [System.Text.Encoding]::UTF8.GetBytes($ApiResp.Content)
                $Response.StatusCode = [int]$ApiResp.StatusCode
                $Response.ContentType = "application/json; charset=utf-8"
                $Response.ContentLength64 = $Bytes.Length
                $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
                $Response.Close()
                continue
            }

            if ($Path -eq "/") { $Path = "/index.html" }
            $SafeRel = $Path.TrimStart("/").Replace("/", "\")
            $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $SafeRel))

            if (-not $FullPath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $FullPath -PathType Leaf)) {
                $Response.StatusCode = 404
                $NotFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $Response.OutputStream.Write($NotFound, 0, $NotFound.Length)
                $Response.Close()
                continue
            }

            $Ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
            $Response.ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { "application/octet-stream" }
            $FileBytes = [System.IO.File]::ReadAllBytes($FullPath)
            $Response.StatusCode = 200
            $Response.ContentLength64 = $FileBytes.Length
            $Response.OutputStream.Write($FileBytes, 0, $FileBytes.Length)
            $Response.Close()
        } catch {
            $Response.StatusCode = 500
            $ErrObj = @{ error = @{ message = $_.Exception.Message } } | ConvertTo-Json -Compress
            $ErrBytes = [System.Text.Encoding]::UTF8.GetBytes($ErrObj)
            $Response.ContentType = "application/json; charset=utf-8"
            $Response.OutputStream.Write($ErrBytes, 0, $ErrBytes.Length)
            $Response.Close()
        }
    }
} finally {
    $Listener.Stop()
}
