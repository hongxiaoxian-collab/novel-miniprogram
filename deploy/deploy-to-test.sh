#!/usr/bin/env bash
# ============================================================
#  小说后端 - 一键部署到测试服 120.79.174.44
#
#  用法：
#    bash deploy/deploy-to-test.sh              # 部署代码（不动服务器 .env）
#    SYNC_ENV=1 bash deploy/deploy-to-test.sh   # 连 .env 一起同步（首次部署用）
#
#  做的事：本地打包 -> 上传 -> 停服务 -> 解包/装依赖/建库/编译 -> 起服务 -> 远程自检
#
#  铁律 / 已踩过的坑：
#   1. 只动测试服 120.79.174.44，绝不碰正式服
#   2. 服务器启动必须清空代理环境变量，否则连不上扣子 (os error 10061)
#   3. .cmd 脚本必须是 CRLF 换行，LF 会导致计划任务静默失败
#   4. 【必须】编译前先停服务：服务运行时 node 锁住 Prisma query engine，
#      `prisma generate` 会 exit=1（看似成功其实 Client 没更新，新字段读写全挂）
#   5. 【必须】不能让 node 在编译期间被自动拉起：start-server.cmd 有 :loop 崩溃自愈，
#      编译中 dist 被清空/重写，loop 会把 node 拉到半成品 dist 上，结果部分路由 404
#      （finalize / DELETE 等后声明的路由全丢，e2e 只有 1/5）。用哨兵 pause.lock 根治。
#   6. 【绝对禁止】taskkill /IM node.exe：服务器上还跑着 3000/3010/3020/80/443/8080
#      等别的服务，只能 kill 监听 3001 的那个 PID（pause-server.cmd 已实现）
#   7. 【必须】打包排除 prisma/*.db：否则服务器解包时覆盖被占用的 db 文件报
#      `Can't unlink already-existing object: Permission denied`，tar 返回非 0
#   8. 不要用 `&&` 串联服务器命令：中间一步失败会静默跳过后面所有关键步骤
#      （曾导致"编译没跑、日志是上一次的、接口 404"）。一律用 `&`
#   9. 本机 Git Bash 会把命令里的反斜杠路径转成正斜杠，且 `/d` 被当盘符转换：
#      服务器命令一律用 `C:/...` 正斜杠路径 + `cd`（不要 `cd /d`），
#      也不要 `call C:/...`（call 不吃正斜杠）—— 直接用命令序列
#      （注意：.cmd 脚本内容里的 `cd /d` 是服务器本地执行，不受此影响）
#  10. .cmd 必须是 CRLF 换行，否则 cmd 解析异常/计划任务静默失败
#  11. 【必须】e2e 自检显式传 BASE=http://<测试服>:3001/novel：脚本默认打 127.0.0.1，
#      本机若残留一个旧后端，就会静默测本机旧代码 → 看起来像远程 404/500 全挂
# ============================================================
set -euo pipefail

HOST="120.79.174.44"
SSH_USER="Administrator"
KEY="${HOME}/.ssh/erp_deploy_ed25519"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=20)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
TARBALL="/tmp/novel-backend-src.tar.gz"
REMOTE_BACKEND="C:/erp/novel-backend"

sshx() { ssh "${SSH_OPTS[@]}" "${SSH_USER}@${HOST}" "$@"; }
clean() { tr -d '\000' | grep -av "WARNING\|post-quantum\|store now\|may need" || true; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

step "1/6 打包后端源码（排除 node_modules / dist / .env / *.db）"
rm -f "$TARBALL"
( cd "$BACKEND" && tar -czf "$TARBALL" \
    --exclude=node_modules --exclude=dist --exclude=.env \
    --exclude='prisma/*.db' --exclude='prisma/*.db-journal' \
    src prisma scripts package.json package-lock.json \
    tsconfig.json tsconfig.build.json nest-cli.json .env.example )
ls -lh "$TARBALL" | awk '{print "   包大小: "$5}'

step "2/6 上传源码包 + 服务器运维脚本"
scp "${SSH_OPTS[@]}" "$TARBALL" "${SSH_USER}@${HOST}:C:/erp/novel-backend-src.tar.gz" >/dev/null
scp "${SSH_OPTS[@]}" "$ROOT/deploy/start-server.cmd" "$ROOT/deploy/pause-server.cmd" "$ROOT/deploy/resume-server.cmd" \
  "${SSH_USER}@${HOST}:${REMOTE_BACKEND}/" >/dev/null
if [ "${SYNC_ENV:-0}" = "1" ]; then
  cp "$BACKEND/.env" /tmp/novel-env
  scp "${SSH_OPTS[@]}" /tmp/novel-env "${SSH_USER}@${HOST}:${REMOTE_BACKEND}/.env" >/dev/null
  echo "   已同步 .env"
fi
echo "   上传完成"

step "3/6 停服务（哨兵 pause.lock + 只 kill 3001 端口的 node）"
# 铁律：服务器上还有 3000/3020/80/443/8080 等别的服务，绝不能 taskkill /IM node.exe
# 哨兵文件让 start-server.cmd 的 :loop 退出，否则它会在编译中途把 node 拉到半成品 dist 上
sshx "cd ${REMOTE_BACKEND} & pause-server" 2>&1 | clean | tail -5

step "4/6 解包 + 装依赖 + 生成 Prisma Client + 建库 + 编译（约 1-2 分钟，前台等）"
sshx "cd ${REMOTE_BACKEND} & tar -xzf C:/erp/novel-backend-src.tar.gz & set PATH=C:/erp/node;%PATH% & npm install --registry=https://registry.npmmirror.com/ --no-audit --no-fund & rmdir /s /q dist & npx prisma generate & npx prisma db push --skip-generate & npm run build" 2>&1 \
  | clean | tail -22

step "5/6 启动服务（删哨兵 -> 跑计划任务）"
sshx "cd ${REMOTE_BACKEND} & resume-server" 2>&1 | clean | head -3
sleep 15

step "6/6 远程自检"
curl --noproxy '*' -s -m 15 -o /dev/null -w "   服务状态页 HTTP=%{http_code}\n" "http://${HOST}:3001/" || echo "   服务未响应！"
# 【必须】显式指定 BASE：e2e 默认打 127.0.0.1:3001，本机若也开着旧后端，
# 就会静默地测本机旧代码（表现为 finalize 404 之类，误判成远程挂了）
if [ "${SKIP_E2E:-0}" = "1" ]; then
  echo "   已跳过 e2e（SKIP_E2E=1，省扣子额度）"
else
  BASE="http://${HOST}:3001/novel" "${NODE_BIN:-node}" "$BACKEND/scripts/e2e-coze.mjs" fanqie || true
fi

step "部署结束。服务状态页: http://${HOST}:3001/"
