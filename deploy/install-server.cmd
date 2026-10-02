@echo off
REM ============================================================
REM  小说后端 - 服务器端安装脚本（在测试服 120.79.174.44 上运行）
REM  作用：装依赖 -> 生成 Prisma Client -> 建库 -> 编译
REM  日志：C:\erp\novel-backend\install.log
REM  注意：本文件必须是纯 ASCII，中文会因编码问题乱码
REM ============================================================
setlocal
set PATH=C:\erp\node;%PATH%
cd /d C:\erp\novel-backend

echo [%date% %time%] ===== INSTALL START ===== > install.log
echo [%date% %time%] node version: >> install.log
node -v >> install.log 2>&1

echo [%date% %time%] ----- step 1/4 npm install ----- >> install.log
call npm install --registry=https://registry.npmmirror.com/ --no-audit --no-fund >> install.log 2>&1
echo [%date% %time%] npm install exit=%ERRORLEVEL% >> install.log

echo [%date% %time%] ----- step 2/4 prisma generate ----- >> install.log
call npx prisma generate >> install.log 2>&1
echo [%date% %time%] prisma generate exit=%ERRORLEVEL% >> install.log

echo [%date% %time%] ----- step 3/4 prisma db push ----- >> install.log
call npx prisma db push --skip-generate >> install.log 2>&1
echo [%date% %time%] prisma db push exit=%ERRORLEVEL% >> install.log

echo [%date% %time%] ----- step 4/4 npm run build ----- >> install.log
call npm run build >> install.log 2>&1
echo [%date% %time%] build exit=%ERRORLEVEL% >> install.log

echo [%date% %time%] ===== INSTALL DONE ===== >> install.log
echo ALL_DONE >> install.log
endlocal
