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

ROOT="$(cd "$(dirname "$0")/.." && pwd -W)"
CLI="C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
KEY="C:/Users/53430/.ssh/erp_deploy_ed25519"
VER_FILE="$ROOT/deploy/version.txt"
# 上传必须用**真实**项目路径：换个联接路径（mklink /J）给 IDE，CLI 会卡在 "- Upload" 不动。
PROJ="$ROOT"
# 临时 ps1/日志放在无中文的联接目录：bash 把含中文的路径当参数传给 powershell 有乱码风险
PSDIR="C:/novel-app"
[ -d "$PSDIR/deploy" ] || PSDIR="$ROOT"
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
echo "==> 3/3 上传小程序 v$VER（$PROJ）"
# 必须绕开 Git Bash 直调 .bat：只要任一参数含中文（项目路径、备注），整行引号就会丢，
# cmd 报 "'C:\Program' 不是内部或外部命令"。改由 PowerShell 执行，路径全部走无中文的联接目录。
PS1="$PSDIR/deploy/.upload.ps1"
LOG="$PSDIR/deploy/.upload.log"
{
  printf '\xEF\xBB\xBF'                       # UTF-8 BOM：PowerShell 5.1 才不会把中文读成乱码
  printf '& "%s" upload --project "%s" -v %s -d "%s" *>&1 | Out-File -Encoding utf8 "%s"\n' \
    "$CLI" "$PROJ" "$VER" "$MSG" "$LOG"
} > "$PS1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$PS1" > /dev/null 2>&1 || true
grep -a -v "post-quantum\|store now\|openssh.com\|DeprecationWarning\|trace-deprecation" "$LOG" | tail -8
if grep -a -q "服务端口已关闭\|IDE service port disabled" "$LOG"; then
  echo ""
  echo "× 上传失败：开发者工具的服务端口没开。"
  echo "  手动开一次：微信开发者工具 -> 设置 -> 安全设置 -> 服务端口 -> 开启"
  rm -f "$PS1" || true; exit 1
fi
grep -a -q "√ upload\|upload" "$LOG" || echo "× 没看到上传成功标记，请到开发者工具或公众平台确认"
# 版本号必须先落盘：沙箱的删除拦截会让 rm 非 0 退出，set -e 直接把脚本掐死，
# 版本号就停在旧值 —— 下次发布会用同一个版本号再传一遍（2026-10-10 实际踩到）。
echo "$VER" > "$VER_FILE"
rm -f "$PS1" || true
echo "    版本号已写入 deploy/version.txt -> $VER"
echo ""
echo "==> 完成。下一步：微信公众平台 -> 版本管理 -> 把 v$VER 提交审核（或先设为体验版）"
exit 0
