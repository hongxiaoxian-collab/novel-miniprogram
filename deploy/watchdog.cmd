@echo off
REM ============================================================
REM  Novel backend watchdog - runs every 1 minute (task NovelWatchdog)
REM  If port 3001 is not listening, restart the NovelBackend task.
REM  IMPORTANT: this file must stay pure ASCII (no Chinese chars).
REM ============================================================
setlocal
cd /d C:/erp/novel-backend

REM deploy in progress -> never touch anything
if exist pause.lock exit /b 0

netstat -ano | findstr ":3001 " | findstr LISTENING >nul
if "%ERRORLEVEL%"=="0" exit /b 0

REM node may be mid-restart (start-server.cmd heals in ~5s): wait 10s and re-check
ping -n 11 127.0.0.1 >nul
netstat -ano | findstr ":3001 " | findstr LISTENING >nul
if "%ERRORLEVEL%"=="0" exit /b 0

echo [%date% %time%] WATCHDOG: 3001 down, starting NovelBackend >> watchdog.log
schtasks /run /tn NovelBackend >> watchdog.log 2>&1
exit /b 0
