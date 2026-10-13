@echo off
REM ============================================================
REM  部署期间暂停小说后端（只针对 3001 端口的 node，不动服务器上其他服务）
REM  1) 放哨兵 pause.lock：start-server.cmd 的 :loop 看到就退出，不再自动拉起
REM  2) 停计划任务，再精确 kill 监听 3001 的进程（3000/3020/80 是别的服务，绝不碰）
REM ============================================================
cd /d C:/erp/novel-backend
echo paused > pause.lock
schtasks /end /tn NovelBackend >nul 2>&1
ping -n 3 127.0.0.1 >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
  echo killing pid %%a
  taskkill /F /PID %%a >nul 2>&1
)
ping -n 4 127.0.0.1 >nul
netstat -ano | findstr :3001 | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
  echo PORT-3001-STILL-BUSY
  exit /b 1
)
echo PORT-3001-FREE
exit /b 0
