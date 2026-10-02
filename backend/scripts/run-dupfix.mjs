// 手动跑一次「撞车一键修复」完整流水线（换名 → 大纲 → 脉络 → 简介 → 黄金三章 → 封面 → 复查重）
// 用法: node scripts/run-dupfix.mjs <id> "<新书名>" ["<差异化剧情>"]
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const id = process.argv[2];
const title = process.argv[3] || '';
const plot = process.argv[4] || '';
if (!id || !title) { console.log('用法: node scripts/run-dupfix.mjs <id> "<新书名>" ["<差异化剧情>"]'); process.exit(1); }

async function j(u, m, b) {
  const r = await fetch(BASE + u, {
    method: m || 'GET',
    headers: { 'content-type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  return r.json().catch(() => ({}));
}

const start = await j('/' + id + '/dup-fix', 'POST', { title, plot });
console.log('启动 →', start.stage, (start.steps || []).length + ' 步');
(start.steps || []).forEach((s) => console.log('   ○ ' + s.label));

const t0 = Date.now();
while (Date.now() - t0 < 30 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 4000));
  const p = await j('/' + id + '/jobs');
  const cur = (p.steps || []).find((s) => s.status === 'running');
  console.log('[' + Math.round((Date.now() - t0) / 1000) + 's] ' + p.stage + ' ' + p.doneCount + '/' + p.total + (cur ? ' 正在：' + cur.label : ''));
  if (p.stage === 'done' || p.stage === 'failed') {
    console.log('--- 各步骤 ---');
    (p.steps || []).forEach((s) => console.log((s.status === 'done' ? '  ✓ ' : s.status === 'failed' ? '  ✗ ' : '  ○ ') + s.label + ' — ' + (s.note || s.error || '')));
    if (p.error) console.log('错误：' + p.error);
    break;
  }
}
