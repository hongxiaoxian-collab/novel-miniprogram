import { Controller, Get, Header } from '@nestjs/common';

/** 根路径服务状态页：浏览器打开直接看服务是否正常、Coze 是否配好 */
@Controller()
export class AppController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  index(): string {
    const ok = (v?: string) => (v ? '<b style="color:#0a0">已配置</b>' : '<b style="color:#c00">未配置</b>');
    const routes = [
      ['GET', '/novel/meta', '平台元数据'],
      ['GET', '/novel', '作品列表'],
      ['POST', '/novel/recommend-topic', '① 题材推荐'],
      ['POST', '/novel', '创建作品'],
      ['POST', '/novel/:id/outline', '② 生成书名+大纲'],
      ['POST', '/novel/:id/bible', '③ 生成全书脉络'],
      ['GET', '/novel/:id/bible', '读取全书脉络'],
      ['GET', '/novel/:id/chapters', '章节列表'],
      ['POST', '/novel/:id/chapter', '④ 生成正文'],
      ['POST', '/novel/:id/chapter/:chId/rewrite', '⑤ 重写章节'],
    ];
    const rows = routes
      .map(
        ([m, p, d]) =>
          `<tr><td class="m ${m === 'GET' ? 'g' : 'p'}">${m}</td><td><code>${p}</code></td><td>${d}</td></tr>`,
      )
      .join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>小说后端服务</title><style>
body{font:14px/1.7 -apple-system,"Microsoft YaHei",sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222}
h1{font-size:20px;margin:0 0 4px}.sub{color:#888;font-size:13px;margin-bottom:22px}
.box{background:#f6f8fa;border:1px solid #e3e7eb;border-radius:8px;padding:14px 16px;margin-bottom:22px}
table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid #eee}
.m{width:56px;font-weight:700;font-size:12px}.g{color:#0a7}.p{color:#c60}
code{background:#eef1f4;padding:1px 6px;border-radius:4px;font-size:13px}
</style></head><body>
<h1>📚 小说后端服务</h1><div class="sub">运行中 · 端口 ${process.env.PORT || 3001} · 这是 API 服务，没有网页界面</div>
<div class="box"><b>扣子配置</b><br>API Key：${ok(process.env.COZE_API_KEY)} &nbsp;|&nbsp; Bot ID：${ok(process.env.COZE_BOT_ID)}
<br><span style="color:#888;font-size:13px">测接口请用 API 工具（或 curl），不是浏览器地址栏。</span></div>
<table>${rows}</table></body></html>`;
  }
}
