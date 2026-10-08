@echo off
REM TraceNet backend — development launcher (hot reload, HTTP :8000) using the project venv.
cd /d "%~dp0"
"%~dp0..\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000 %*
