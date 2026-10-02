# 小说小程序后端（NestJS + Prisma + Coze）

番茄 / 七猫 上架辅助 + AI 写稿引擎的服务端。小程序 → 本服务 → 扣子(Coze) API。

## 目录
```
backend/
  src/
    main.ts                # 启动入口（端口 3001）
    app.module.ts
    prisma/                # PrismaService
    coze/coze.service.ts   # 调用扣子 Chat API（key 仅存服务端）
    platform/platform.config.ts  # 番茄/七猫标签枚举（待核实官方文档后替换【待核对】）
    novel/                 # 作品/章节/全书脉络 的 controller+service+dto
  prisma/schema.prisma     # Novel / Chapter 模型
```

## 本地运行
```bash
npm install
cp .env.example .env      # 填 COZE_API_KEY / COZE_BOT_ID
npx prisma db push        # 建库（SQLite，生成 novel.db）
npm run start
# 健康检查： curl http://localhost:3001/novel/meta
```

## 部署到测试服 120.79.174.44（Windows）
1. 把 `backend/` 整目录传到服务器（如 `C:\erp\novel-backend`）。
2. 服务器装 Node 22（与本地同版本），进入目录 `npm install`，`cp .env.example .env` 并填密钥。
3. `npx prisma db push` 建库。
4. 用 `npm run start:prod` 或 pm2/nssm 常驻（端口 3001，避开 ERP 的 3000）。
5. 防火墙放行 3001；小程序 `app.js` 的 `baseUrl` 改为 `http://120.79.174.44:3001`。
6. 微信开发者工具里勾选「不校验合法域名」以便调试。

> 仅测试服，不动正式服 39.105.207.147。上线前再评估切 PostgreSQL 与微信登录。

## 接口一览
| Method | Path | 说明 |
|---|---|---|
| GET | /novel/meta | 平台标签枚举 |
| GET | /novel?platform= | 作品列表 |
| POST | /novel | 新建作品 |
| PUT | /novel/:id | 编辑作品（介绍页） |
| GET | /novel/:id | 作品详情 |
| POST | /novel/recommend-topic | AI 按平台推荐题材 |
| POST | /novel/:id/outline | AI 起名+大纲（可带 opinion 重来） |
| POST | /novel/:id/bible | 定版生成《全书脉络》（可带 reason/opinion 做整部调整） |
| GET | /novel/:id/bible | 取全书脉络 |
| GET | /novel/:id/chapters | 章节目录（按卷） |
| POST | /novel/:id/chapter | AI 续写下一章（强带全书脉络，支持 wordCount 硬指标） |
| POST | /novel/:id/chapter/:chId/rewrite | 按重写原因/意图改写该章（保留全书脉络一致） |
| PUT | /novel/:id/chapter/:chId | 保存章节编辑 |

## 关键产品规则（已实现）
- **每章字数 = 硬指标**：Novel.chapterWords 默认 2000，新建/续写均可改；写稿与重写 prompt 强制「必须达到 X 字，未达标不许收尾」。
- **整部调整**：审核未过 / 未审核调整，均走 POST /novel/:id/bible（带 reason），让 bot 重调人设/情节/伏笔并规避红线。
- **重写**：POST /novel/:id/chapter/:chId/rewrite（带 reason），AI 按用户意图改写该章，不推翻已锁死事实。
- **防走偏/重复/断链**：定版生成《全书脉络》+ 每章强带脉络/目录/上章摘要 + 写前查三档/写完更五档（后台标准，界面不显示）。

## 防走偏/重复/断链机制（核心）
- 定版时一次性生成《全书脉络》(JSON)：十档设定+六大状态锁+伏笔台账+分卷章纲。
- 每章写稿请求都把 全书脉络 + 章节目录 + 上章摘要 注入 prompt，并附「写前查三档/写完更五档」后台强制标准。
- 这些规则在 `novel.service.ts` 的 prompt 构造与 `coze-bot-design.md` 的 bot 人设里双重固化。
