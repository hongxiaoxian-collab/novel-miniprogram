@echo off
REM ============================================================
REM  小说后端 - 测试服常驻启动（测试服 120.79.174.44）
REM  关键1：必须清空代理环境变量，否则连不上扣子 (os error 10061)
REM  关键2：带崩溃自愈 - 进程挂了 5 秒后自动拉起
REM  关键3：看到 pause.lock 就退出循环 —— 部署编译期间绝不能让 node 跑到半成品 dist
REM  日志：C:/erp/novel-backend/serve.log
REM  由计划任务 NovelBackend 调用（开机自启 + 崩溃自愈）
REM ============================================================
setlocal
set PATH=C:/erp/node;%PATH%
cd /d C:/erp/novel-backend

set HTTPS_PROXY=
set HTTP_PROXY=
set https_proxy=
set http_proxy=
set NO_PROXY=*
set no_proxy=*

:loop
if exist pause.lock (
  echo [%date% %time%] ===== PAUSED by deploy (pause.lock) , exit loop ===== >> serve.log
  exit /b 0
)
echo [%date% %time%] ===== SERVE START ===== >> serve.log
node dist\main.js >> serve.log 2>&1
echo [%date% %time%] ===== SERVE EXIT code=%ERRORLEVEL% , restart in 5s ===== >> serve.log
timeout /t 5 /nobreak >nul
goto loop
