# TraceNet backend — development launcher (hot reload, HTTP :8000).
# Always uses the project venv so `uvicorn` never resolves to a global Python.
$ErrorActionPreference = "Stop"
$venvPython = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Project venv not found at $venvPython" -ForegroundColor Red
    Write-Host "Create it from the repo root:  python -m venv .venv ; .\.venv\Scripts\pip install -r backend\requirements.txt"
    exit 1
}
Set-Location $PSScriptRoot
& $venvPython -m uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000 @args
