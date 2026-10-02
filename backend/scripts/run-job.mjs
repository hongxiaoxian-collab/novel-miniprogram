// 启动一个后台任务并轮询到结束（验证 audit / fix / chapter / outline 四种任务都跑得通）
// 用法: node scripts/run-job.mjs <kind> [id] [opinion]
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const kind = process.argv[2] || 'audit';
const ID = process.argv[3] || 'cmupjt6sp0001psbwxa5ch5wa';
const opinion = process.argv[4] || '';

async function j(u, m, b) {
  const r = await fetch(BASE + u, {
    method: m || 'GET',
    headers: { 'content-type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  return r.json().catch(() => ({}));
}

const start = await j('/' + ID + '/jobs', 'POST', { kind, opinion: opinion || undefined });
console.log('启动 ' + kind + ' →', JSON.stringify(start).slice(0, 200));

const t0 = Date.now();
while (Date.now() - t0 < 20 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 3000));
  const p = await j('/' + ID + '/jobs');
  const line = '[' + Math.round((Date.now() - t0) / 1000) + 's] ' + p.stage
    + ' ' + p.doneCount + '/' + p.total + ' 当前：' + (p.current || '-');
  console.log(line);
  if (p.stage === 'done') {
    console.log('各步骤：');
    (p.steps || []).forEach((s) => console.log('  ' + (s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '○') + ' ' + s.label + ' — ' + (s.note || s.error || '')));
    console.log('产出：' + JSON.stringify(p.result || null).slice(0, 300));
    break;
  }
  if (p.stage === 'failed') { console.log('失败：' + p.error); break; }
}
