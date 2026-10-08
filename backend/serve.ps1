# TraceNet backend — HTTP :8000 + HTTPS :8443 (phones / edge cameras), no hot reload. Uses the project venv.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& (Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe") serve.py @args
