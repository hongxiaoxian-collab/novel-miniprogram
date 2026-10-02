@echo off
REM 恢复：删哨兵 -> 起计划任务（start-server.cmd 的 :loop 会拉起 node）
cd /d C:/erp/novel-backend
if exist pause.lock del pause.lock
schtasks /run /tn NovelBackend >nul 2>&1
echo RESUMED
exit /b 0
