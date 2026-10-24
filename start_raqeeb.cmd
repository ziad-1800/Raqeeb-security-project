@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Install first: python -m venv .venv
  echo Then: .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause
  exit /b 1
)
echo Open http://localhost:8000 and click Start monitoring.
".venv\Scripts\python.exe" server.py %*
pause
