@echo off
echo Starting Context Subtitles Application...
echo.

REM Set CUDA path
set "PATH=C:\Program Files\NVIDIA\CUDNN\v9.13\bin\12.9;%PATH%"

REM Start all services in parallel
start "Server" cmd /k "cd /d D:\cse_518_project\context-subtitles\server && node index.js"
start "ASR Service" cmd /k "cd /d D:\cse_518_project\context-subtitles\asr && .\.venv\Scripts\activate && python stream.py --model medium --lang en --beam 3 --rms-thresh 0.0025 --silence-hold 300 --vad-threshold 0.45"
start "Client" cmd /k "cd /d D:\cse_518_project\context-subtitles\client && npm run dev -- --host"

echo All services started!
echo.
echo Server: http://localhost:3000
echo Client: http://localhost:5173
echo.
echo Press any key to close all services...
pause >nul

REM Kill all related processes when script ends
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
for /f "tokens=2" %%i in ('tasklist /fi "windowtitle eq Server*" ^| findstr cmd') do taskkill /f /pid %%i >nul 2>&1
for /f "tokens=2" %%i in ('tasklist /fi "windowtitle eq ASR*" ^| findstr cmd') do taskkill /f /pid %%i >nul 2>&1
for /f "tokens=2" %%i in ('tasklist /fi "windowtitle eq Client*" ^| findstr cmd') do taskkill /f /pid %%i >nul 2>&1

echo All services stopped.