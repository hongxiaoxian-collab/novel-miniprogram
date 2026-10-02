// 体检 / 后台任务 自检：确认结果落库、分组（可自动修 / 需你拍板）、修复方案都在
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const ID = process.env.ID || 'cmupjt6sp0001psbwxa5ch5wa';

async function j(u, m, b) {
  const r = await fetch(BASE + u, {
    method: m || 'GET',
    headers: { 'content-type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  return r.json().catch(() => ({}));
}

const a = await j('/' + ID + '/audit');
if (!a.audit) {
  console.log('GET /audit → 还没有体检结果');
} else {
  const x = a.audit;
  console.log('GET /audit → score=' + x.score
    + ' 共' + x.issues.length + '处（硬伤' + x.hardCount + ' / AI ' + x.aiCount + '）'
    + ' 可自动修=' + (x.autoFix || []).length
    + ' 需拍板=' + (x.human || []).length
    + ' 方案=' + (x.options || []).length
    + ' 查重=' + (x.dup ? x.dup.risk : '无')
    + ' cached=' + x.cached + ' stale=' + a.stale);
}

const jb = await j('/' + ID + '/jobs');
console.log('GET /jobs → kind=' + jb.kind + ' stage=' + jb.stage
  + ' ' + jb.doneCount + '/' + jb.total
  + ' result=' + JSON.stringify(jb.result || null).slice(0, 120));
