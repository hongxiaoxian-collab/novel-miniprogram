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
