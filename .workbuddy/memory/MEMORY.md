# 小说小程序（志诚智能）项目长期约定

## 发布流程铁律（用户 2026-10-02 明确要求）
**修正完 → 部署测试服 → 备份代码到代码仓 → 上传小程序。**
只要涉及「修正并上传小程序代码」，必须先把代码备份（commit + push）到代码仓，不用再问用户。

一键完成：`bash deploy/release.sh`（可选 `-m "说明"` / `-v 版本` / `--deploy` 先部署测试服）

## 关键地址
- 代码仓（Codeup）：`zcig@zcig-cn-hangzhou.devops.aliyuncs.com:codeup/novel-miniprogram.git`（分支 master，密钥 `C:/Users/53430/.ssh/erp_deploy_ed25519`；SSH 路径不要带 `/zcig/`）
- 测试服：`http://120.79.174.44:3001`（后端 NestJS，部署脚本 `deploy/deploy-to-test.sh`，`SKIP_E2E=1` 省扣子额度）
- 小程序：志诚智能 `appid=wx879e614f17e6d355`，上传时 `--project` 必须指**项目根目录**（`miniprogram/` 那份配置是 touristappid）
- 微信开发者工具 CLI：`C:/Program Files (x86)\Tencent/微信web开发者工具/cli.bat`（需手动开启「设置→安全设置→服务端口」）

## 架构
微信原生小程序（无框架）+ NestJS + Prisma(SQLite) + 扣子 Coze API（key 只在后端）。
平台双轨：番茄 / 七猫。核心闭环：生成 → 体检（查矛盾 + 查撞车）→ 修复 → 发布。

## 已确立的业务规则
- **续更 = 发布**：每章写完立刻跑发布前自检，最多 3 轮「查→修→复检」，可自动修问题归零才算通过；自检只查矛盾不查撞车。
- 一键体检支持分项：`scope=both | consistency | dup`，只查一项时另一项沿用上次结论。
- 体检必须收敛：连点多次结果必须一致，修一轮条数只能变少。
- **长任务入口必须幂等**（2026-10-06 实战事故）：同一作品同一时刻只能跑一个定版
  （`novel.service.ts` 的 `finalizing` 集合）。作者点两次 / 退出后被草稿恢复再点一次 → 两任务并发
  各写黄金 3 章 → 库里成 `1,1,2,2,3,3` 六章。凡是"能退出再进来"的长任务都要这样防重复。
- **草稿 / globalData 里的实体 id，使用前必须到服务端校验存在性**（同上事故）：作品被删除后草稿仍留旧
  id → 「新建小说」串回旧稿、重出大纲永远 404 报错（作者体感 = 删了还在、卡死循环）。
  「新建小说」入口固定带 `?fresh=1`（清草稿 + 清 `app.globalData.novelId`）。
- 章数统计口径必须统一：列表 / 进度 / 章节目录都只数 `stale=false` 的有效章，
  章号重复时只留最新一稿（`dedupeChapters`，接口 `POST /novel/:id/dedupe`）。

## 测试服掉线排查（2026-10-06 实战）
- 作者报「作品不见了」时，**先 curl 判断是服务挂了还是数据真丢**：
  `curl -o /dev/null -w "%{http_code}" --noproxy '*' http://120.79.174.44:3001/`
  → `000` = 服务没起（数据在，别慌）；`200` 但列表空 = 才查数据。
- 服务由计划任务 `NovelBackend`（BootTrigger + `start-server.cmd` 的 `:loop` 自愈）托管。
  开机触发器只在重启时生效，实例被终止后不会自愈 → 需手动 `resume-server.cmd` 拉起。
- **2026-10-06 已加第二层守护**：计划任务 `NovelWatchdog`（`deploy/watchdog.cmd`，每分钟一次）——
  3001 没监听就 `schtasks /run /tn NovelBackend`；遇 `pause.lock`（部署中）自动跳过。日志 `watchdog.log`。
  已端到端实测：`schtasks /end /tn NovelBackend` + 杀 node 后 95 秒自动恢复。
  服务器上**没有 wmic**，要精确终止循环用 `schtasks /end /tn <任务名>`，别用 `taskkill /IM cmd.exe`（会误伤同机器的 ERP）。
- 数据库文件路径 `C:\erp\novel-backend\prisma\novel.db`，几百 KB 即代表数据完好。
- SSH 命令：服务器路径一律用正斜杠；输出要 `| tr -d '\000' | grep -a -v "post-quantum|store now"`；
  读 `~/.ssh/erp_deploy_ed25519` 需 `dangerouslyDisableSandbox: true`。

## 账号 / 登录 / 等级（2026-10-02 建成，2026-10-06 已启用）
- 后端 `auth` 模块 + `plan.ts` 套餐表 + `User`/`Order` 表已上线。
- **2026-10-06 已启用**：作者给了 AppSecret，已写入服务器 `C:/erp/novel-backend/.env`
  （`WX_APPID` / `WX_APP_SECRET` / `AUTH_SECRET`，后者用 `secrets.token_hex(32)` 强随机生成），后端已重启。
  实测 `GET /auth/plans` → `enabled:true`。AppID：`wx879e614f17e6d355`。
- **验证技巧**：用假 code 调 `POST /auth/login`，微信回 `40029` = 密钥正确（只是 code 无效）；
  回 `40013`/`40125` 才是 appid/secret 错；超时才是网络不通。
- **重启后端的正确姿势**（服务器上）：杀 3001 监听 PID → `start-server.cmd` 的自愈循环 5 秒内自动拉起。
  注意 `timeout /t` 在 ssh 无 stdin 环境会报「不支持输入重新定向」，要用 `ping -n N 127.0.0.1` 代替 sleep。
- 登录是**静默**的（只换 openid），不弹授权框、不收头像昵称手机号；任何失败降级为游客。
- 作品归属：新建作品带 userId；**历史作品 userId 为空且对所有登录用户仍可见**——
  这是刻意设计，避免作者一登录就以为作品丢了。
- 等级差异全部集中在 `backend/src/auth/plan.ts` 的 `PLANS`，业务代码无 `if(level==='vip')`。
  **配额目前只统计展示、不做拦截**，等作者给具体要求再接入。
