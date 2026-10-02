// 对指定作品跑一次「一致性体检」，把问题清单打印出来
// 用法: node backend/scripts/audit-mynovel.mjs <novelId>
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const id = process.argv[2];
if (!id) {
  console.error('用法: node audit-mynovel.mjs <novelId>');
  process.exit(1);
}
const r = await fetch(`${BASE}/${id}/audit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const txt = await r.text();
if (!r.ok) {
  console.error('HTTP', r.status, txt.slice(0, 500));
  process.exit(1);
}
const j = JSON.parse(txt);
console.log(`体检完成：${j.score} 分｜已核对 ${j.checkedChapters} 章`);
console.log(`总评：${j.summary || '（无）'}`);
console.log(`问题数：${(j.issues || []).length}`);
(j.issues || []).forEach((x, i) => {
  console.log(`\n[${i + 1}] ${x.level}｜${x.type}｜第${x.chapter}章`);
  console.log(`  原文：${x.quote}`);
  console.log(`  问题：${x.why}`);
  console.log(`  建议：${x.fix}`);
});
