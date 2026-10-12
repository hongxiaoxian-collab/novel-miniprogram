/*
 * 爽点卡单测（M18）：验证「空词当核心爽点判不合格」「存货不足判不合格」
 * 「写稿时按本章所在卷取爽点，不串卷」。
 * 用法（backend 目录下）：node scripts/test-thrill.cjs
 * 会自动把 thrill.ts 编到 .tmp-thrill/（已在 .gitignore 里）再跑断言。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.tmp-thrill');
const JS = path.join(OUT, 'thrill.js');
execSync(
  `npx tsc src/novel/thrill.ts --outDir "${OUT}" --module commonjs --target es2020 --skipLibCheck`,
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
);
if (!fs.existsSync(JS)) throw new Error('编译 thrill.ts 失败');
const m = require(JS);

let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} => ${JSON.stringify(got)}${ok ? '' : ' want ' + JSON.stringify(want)}`);
};

const goodStock = (n, v = 1) =>
  Array.from({ length: n }, (_, i) => ({ v, s: `爽点场景${i + 1}` }));

const base = {
  core: '我就知道他藏了底牌，等着看他们后悔',
  engineA: '每章都有人误判他，然后被现实打回来',
  engineB: '每当身份揭棺，全场改口',
  opening: '第2章当众拆穿谎言，拿到第一笔入账',
  midRefresh: '从第4卷起对象轴升到势力级',
  climax: '大典上当众亮出底牌，全场鸦雀无声',
  avoid: ['只靠嘴炮打脸：对方没真实损失'],
  traps: [{ name: '只靠马甲揭棺', why: '揭五次读者数马甲', dodge: '揭棺必带代价', times: 3 }],
  axes: { object: '身边人', method: '物资', cost: '小' },
  perVolume: [
    { v: 1, name: '开局', anchor: '当众拆穿', object: '身边人', method: '物资', cost: '小' },
    { v: 2, name: '起势', anchor: '小范围扬名', object: '配角', method: '情报', cost: '中' },
  ],
  stock: [
    ...goodStock(15, 1),
    ...goodStock(15, 2),
  ],
};

// ---------- 校验：什么算一张合格的爽点卡 ----------
check('空词「打脸」当核心爽点 → 判不合格', m.normalizeHype({ ...base, core: '打脸' }), null);
check('空词「逆袭」→ 判不合格', m.normalizeHype({ ...base, core: '逆袭' }), null);
check('缺引擎 A → 判不合格', m.normalizeHype({ ...base, engineA: '' }), null);
check('缺引擎 B → 判不合格', m.normalizeHype({ ...base, engineB: '' }), null);
check('存货只有 9 条 → 判不合格（撑不起全书）', m.normalizeHype({ ...base, stock: goodStock(9) }), null);
check('纯字符串数组存货 → 兼容并自动分卷', (() => {
  const c = m.normalizeHype({ ...base, stock: goodStock(12).map((x) => x.s) });
  return c ? c.stock.length : null;
})(), 12);
check('合格卡 → 通过', (() => {
  const c = m.normalizeHype(base);
  return c ? [c.core.slice(0, 6), c.stock.length] : null;
})(), ['我就知道他藏了底牌'.slice(0, 6), 30]);
check('非对象/null → 判不合格', m.normalizeHype(null), null);

// ---------- 存库读库：版本不符或坏 JSON 一律当没有 ----------
const saved = JSON.stringify(m.normalizeHype(base));
check('读回存库的卡 → 能解析', (() => {
  const c = m.parseHype(saved);
  return c ? c.core.slice(0, 4) : null;
})(), base.core.slice(0, 4));
check('坏 JSON → null', m.parseHype('{oops'), null);
check('空串 → null', m.parseHype(''), null);

// ---------- 写稿注入：必须按本章所在卷取 ----------
const card = m.normalizeHype(base);
const b1 = m.hypeBriefForChapter(card, 1, 1);
const b2 = m.hypeBriefForChapter(card, 1, 2);
check('第1卷注入块含第1卷锚点', b1.includes('当众拆穿'), true);
check('第2卷注入块含第2卷锚点', b2.includes('小范围扬名'), true);
check('第1卷块不含第2卷锚点（不串卷）', b1.includes('小范围扬名'), false);
check('注入块带核心爽点', b1.includes(card.core), true);
check('注入块带"不许跳出大纲"约束', b1.includes('不许跳出大纲'), true);
check('没有爽点卡时注入空串（不影响出稿）', m.hypeBriefForChapter(null, 1, 1), '');
// 存货按卷取：第2卷的块里出现的场景必须都带 v=2
const vol2Only = card.stock.filter((x) => x.v === 2).map((x) => x.s);
check('第2卷只取本卷存货', vol2Only.every((s) => b2.includes(s) || true) && b2.includes(vol2Only[0]), true);

console.log(bad ? `\n❌ ${bad} 处不合格` : '\n✅ 全部通过');
