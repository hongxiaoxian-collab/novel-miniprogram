// 体检稳定性诊断：同一部作品连跑 N 次，看问题条数是否稳定。
// 用法: node backend/scripts/audit-repeat.mjs <novelId> [times] [force]
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const id = process.argv[2];
const times = Number(process.argv[3] || 3);
const force = process.argv[4] === 'force' ? '?force=1' : '';
if (!id) {
  console.error('用法: node audit-repeat.mjs <novelId> [times] [force]');
  process.exit(1);
}

const run = async (i) => {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/${id}/audit${force}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const j = await r.json();
  if (!r.ok) return console.log(`第 ${i} 次：HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  const issues = j.issues || [];
  const byType = {};
  issues.forEach((x) => { byType[x.type] = (byType[x.type] || 0) + 1; });
  console.log(
    `第 ${i} 次：共 ${issues.length} 条（硬伤 ${j.hardCount ?? '-'} / AI ${j.aiCount ?? '-'}）` +
    `｜可自动修 ${j.fixableCount ?? '-'}｜缓存 ${j.cached ? '是' : '否'}｜${Date.now() - t0}ms` +
    `\n         分类：${JSON.stringify(byType)}`,
  );
  return issues.map((x) => `${x.type}|第${x.chapter}章|${(x.quote || '').slice(0, 26)}`);
};

const sigs = [];
for (let i = 1; i <= times; i++) sigs.push(await run(i));

// 用「类型+章号+原句」当签名，比较各次结果是否一致
const uniq = [...new Set(sigs.map((s) => JSON.stringify(s)))];
console.log(`\n结论：${times} 次结果签名 ${uniq.length === 1 ? '完全一致（稳定）' : `有 ${uniq.length} 种（不稳定）`}`);
if (uniq.length > 1) {
  const a = JSON.parse(uniq[0]).length;
  const b = JSON.parse(uniq[1] || '[]').length;
  console.log(`  条数：${sigs.map((s) => s.length).join(' / ')}  ← 差 ${Math.abs(a - b)} 条`);
}
