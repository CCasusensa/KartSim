@echo off
rem KartSim one-click start for Windows (Docker Desktop). See docker-start.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-start.ps1" %*
pause
