// 只读：把最近一次体检结果原样打印出来（不触发任何 AI、不改稿），便于人工核对
// 用法: node scripts/audit-report.mjs <novelId>
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const ID = process.argv[2] || 'cmupjt6sp0001psbwxa5ch5wa';

const r = await fetch(BASE + '/' + ID + '/audit').then((x) => x.json());
const a = r.audit;
if (!a) { console.log('还没有体检结果'); process.exit(0); }

console.log('《体检报告》 分数 ' + a.score + ' ｜ 已核对 ' + a.checkedChapters + ' 章 ｜ 硬伤 '
  + a.hardCount + ' · AI ' + a.aiCount + ' ｜ ' + a.summary);
if (a.noAxis) console.log('⚠ 全书脉络为空，本次只做了章节间互相比对');

const line = (x, i) => {
  console.log('  ' + (i + 1) + '. [' + x.level + '·' + x.type + ']'
    + (x.chapter ? ' 第' + x.chapter + '章' : '')
    + (x.hard ? '（硬伤）' : '')
    + (x.needHuman ? '（需你拍板）' : ''));
  console.log('     原文：“' + x.quote + '”');
  console.log('     问题：' + x.why);
  console.log('     改法：' + x.fix);
};

console.log('\n① 可自动修复（' + (a.autoFix || []).length + '）');
(a.autoFix || []).forEach(line);

console.log('\n② 需要你拍板（' + (a.human || []).length + '）');
(a.human || []).forEach(line);

console.log('\n③ 撞车点（查重）');
if (!a.dup) console.log('  （本次没查重）');
else {
  console.log('  判定：' + a.dup.risk + ' — ' + a.dup.riskNote);
  (a.dup.matches || []).forEach((m) => console.log('  · 《' + m.title + '》（' + m.platform + '·' + m.type + '·相似' + m.similarity + '）：' + m.why));
  if (a.dup.risk !== 'low') {
    console.log('  备选书名：');
    (a.dup.titleSuggestions || []).forEach((t, i) => console.log('   ' + (i === 0 ? '★推荐 ' : '  ') + t));
    if (a.dup.plotAdvice) console.log('  差异化方向：' + a.dup.plotAdvice);
  }
}

console.log('\n④ 修复方案（' + (a.options || []).length + '）');
(a.options || []).forEach((o, i) => {
  console.log('  ' + (i + 1) + '. ' + o.title + (o.recommend ? '  ★推荐' : ''));
  console.log('     怎么改：' + o.detail);
  console.log('     理由：' + o.reason);
});
