#!/usr/bin/env bash
# 一键发布：备份代码到 Codeup + 上传小程序到微信（志诚智能 wx879e614f17e6d355）
#
# 用法（在 Git Bash 里跑）：
#   bash deploy/release.sh                          # 备份 + 上传（版本自动 +1）
#   bash deploy/release.sh -m "修了某个 bug"          # 指定提交说明
#   bash deploy/release.sh -v 1.2.0                 # 指定小程序版本号
#   bash deploy/release.sh --deploy                 # 先部署测试服，再备份 + 上传
#
# 前提（只需做一次）：
#   微信开发者工具 -> 设置 -> 安全设置 -> 服务端口：开启，并已登录有该小程序权限的微信号
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
KEY="C:/Users/53430/.ssh/erp_deploy_ed25519"
VER_FILE="$ROOT/deploy/version.txt"
export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes"

MSG="chore: 日常修正与同步"
VER=""
DEPLOY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m) MSG="$2"; shift 2 ;;
    -v) VER="$2"; shift 2 ;;
    --deploy) DEPLOY=1; shift ;;
    *) shift ;;
  esac
done

cd "$ROOT"

# 1) 可选：先部署测试服
if [ "$DEPLOY" = 1 ]; then
  echo "==> 1/3 部署测试服"
  SKIP_E2E=1 bash deploy/deploy-to-test.sh
else
  echo "==> 1/3 跳过部署（要部署加 --deploy）"
fi

# 2) 备份代码到 Codeup（没改动就只 push，不产生空提交）
echo "==> 2/3 备份代码到 Codeup"
git add -A
if git diff --cached --quiet; then
  echo "    没有文件改动，跳过提交"
else
  git commit -q -m "$MSG"
  echo "    已提交：$(git log --oneline -1)"
fi
git push origin master 2>&1 | grep -v "WARNING\|post-quantum\|store now\|openssh.com" || true
echo "    远端：$(git ls-remote origin refs/heads/master | cut -f1)"

# 3) 上传小程序（版本号自动 patch+1）
[ -n "$VER" ] || VER="$(awk -F. '{printf "%d.%d.%d",$1,$2,$3+1}' "$VER_FILE" 2>/dev/null || echo 1.0.0)"
echo "==> 3/3 上传小程序 v$VER"
if "$CLI" upload --project "$ROOT" -v "$VER" -d "$MSG" 2>&1 | tee /tmp/wx-upload.log | grep -v "post-quantum\|store now\|openssh.com"; then
  :
fi
if grep -q "服务端口已关闭\|IDE service port disabled" /tmp/wx-upload.log; then
  echo ""
  echo "× 上传失败：开发者工具的服务端口没开。"
  echo "  手动开一次：微信开发者工具 -> 设置 -> 安全设置 -> 服务端口 -> 开启"
  exit 1
fi
echo "$VER" > "$VER_FILE"
echo "    版本号已写入 deploy/version.txt -> $VER"
echo ""
echo "==> 完成。下一步：微信公众平台 -> 版本管理 -> 把 v$VER 提交审核（或先设为体验版）"
