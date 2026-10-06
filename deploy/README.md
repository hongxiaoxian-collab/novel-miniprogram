# 部署到测试服 120.79.174.44

> **铁律**：只动测试服 `120.79.174.44`，绝不直接碰正式服。改代码 → 自动部署测试服 → 用户验证 → 用户下令「部署正式」才上正式服。

## 服务器环境（实测 2026-10-01）
- OS：Windows Server；Node 在 `C:\erp\node\node.exe`（v22.22.2，与本地一致）
- 端口占用：ERP 后端 3000、nginx 80/443、另有 8080。**3001 空闲**，专给小说后端
- 防火墙已放行 TCP 3001（规则名 `Novel Backend 3001`）
- 服务以**计划任务 `NovelBackend`** 常驻：开机自启 + 进程崩溃 5 秒自愈
- 另有一分钟一次的**守护任务 `NovelWatchdog`**（`deploy/watchdog.cmd`）：3001 没监听就 `schtasks /run /tn NovelBackend`。
  第一层（循环自愈）只能救 node 崩，救不了**整个循环死掉**——2026-10-02→10-06 服务就那样挂了几天没人发现，守护是第二层。
  部署期间有 `pause.lock` 时守护会自动跳过，不会跟部署抢。日志：`C:\erp\novel-backend\watchdog.log`
  安装命令：`schtasks /create /tn NovelWatchdog /tr "C:\erp\novel-backend\watchdog.cmd" /sc minute /mo 1 /f`

## 目录
```
C:\erp\novel-backend\          # 后端代码
C:\erp\novel-install.cmd       # 装依赖/编译（npm install + prisma generate + db push + nest build）
C:\erp\novel-start.cmd         # 启动（清代理 + 存活循环）
C:\erp\novel-backend-src.tar.gz
```

## 一键部署（本地执行）
```bash
# 仅部署代码（不覆盖服务器 .env）
bash deploy/deploy-to-test.sh
# 首次部署 / .env 有改动时，同步 .env 一起上传
SYNC_ENV=1 bash deploy/deploy-to-test.sh
```

## 手动分步（排障用）
```bash
# 1. 打包（排除 node_modules/dist/.env）
cd backend && tar -czf ../src.tar.gz --exclude=node_modules --exclude=dist --exclude=.env \
  src prisma scripts package.json package-lock.json tsconfig*.json nest-cli.json .env.example

# 2. 上传 + 解包
scp -i ~/.ssh/erp_deploy_ed25519 src.tar.gz Administrator@120.79.174.44:C:/erp/novel-backend-src.tar.gz
ssh -i ~/.ssh/erp_deploy_ed25519 Administrator@120.79.174.44 \
  'cd /d C:\erp\novel-backend && tar -xzf C:\erp\novel-backend-src.tar.gz'

# 3. 装依赖/编译（服务器端）
ssh ... 'call C:\erp\novel-install.cmd'

# 4. 重启
ssh ... 'schtasks /end /tn NovelBackend & schtasks /run /tn NovelBackend'
```

## 两个致命坑（务必记牢）
1. **启动必须清空代理**：`HTTPS_PROXY= HTTP_PROXY= https_proxy= http_proxy=` —— 否则 `node dist/main.js` 连扣子报 `os error 10061`。`novel-start.cmd` 已内置。
2. **`.cmd` 必须是 CRLF 换行**：LF 会让计划任务静默失败（不写日志、不起进程）。`deploy/*.cmd` 已为 CRLF。

## 远程自检
```bash
# 服务状态页
curl --noproxy '*' http://120.79.174.44:3001/
# 五接口回归
BASE=http://120.79.174.44:3001/novel node backend/scripts/e2e-coze.mjs fanqie
```

## 扣子 Key
服务器 `.env` 的 `COZE_API_KEY` 必须是对 Coze **已发布 bot** 有效的 PAT（前缀 `pat_`，或平台当前有效前缀）。
实测 `uxd_...` 前缀的令牌同样可用（2026-10-01 验证 5/5 通过）。每月需续期，到期替换 `.env` 一行 + 重启计划任务即可。
