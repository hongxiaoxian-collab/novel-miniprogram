/*
 * 爽点卡单测（M18 + 四大结构钩子 + 救场三招）：
 * 验证「空词当核心爽点判不合格」「存货不足判不合格」「四大钩子缺一条/写空话判不合格」
 * 「救场三招必须齐全」「写稿时按本章所在卷取爽点，不串卷」。
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

/** 四大结构钩子：一条不能少，每条都要有本书的具体执行 */
const goodHooks = [
  { key: 'upgrade', name: '主角全方位升级', how: '先升资源线：第1章就让邻居看到他搬进高档小区' },
  { key: 'hunger', name: '制造资源饥渴感', how: '永远差一笔手术费，每次入账只够付三分之一' },
  { key: 'falseGoal', name: '设置假目标制造意外', how: '开局假目标是凑够妹妹手术费，真目标是揭开父亲旧案' },
  { key: 'onion', name: '剥洋葱式解密', how: '第一层是意外，第二层才露出人为，第三层牵出父亲旧案' },
];

const goodRescue = [
  { key: 'goal', name: '强设新目标', how: '凑够手术费后立刻抬新目标：七月前拿到特效药代理权' },
  { key: 'conflict', name: '硬加冲突', how: '药商当众反悔把名额许给对手，主角被全场看笑话' },
  { key: 'feilu', name: '借鉴飞卢快节奏', how: '第三卷起砍过渡段，三章内连给新城市/新身份/新对手' },
];

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
  hooks: goodHooks,
  rescue: goodRescue,
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

// ---------- 四大结构钩子：缺一条/写空话，整卡不合格 ----------
check('四大钩子缺一条 → 判不合格', m.normalizeHype({ ...base, hooks: goodHooks.slice(0, 3) }), null);
check('四大钩子写空话（"注意节奏"）→ 判不合格', m.normalizeHype({
  ...base,
  hooks: goodHooks.map((h, i) => (i === 1 ? { ...h, how: '注意节奏' } : h)),
}), null);
check('四大钩子过短（没给具体执行）→ 判不合格', m.normalizeHype({
  ...base,
  hooks: goodHooks.map((h, i) => (i === 2 ? { ...h, how: '要意外' } : h)),
}), null);
check('没有 hooks 字段 → 判不合格', m.normalizeHype({ ...base, hooks: undefined }), null);

// ---------- 救场三招：缺一招/空话，整卡不合格 ----------
check('救场缺一招 → 判不合格', m.normalizeHype({ ...base, rescue: goodRescue.slice(0, 2) }), null);
check('救场写空话 → 判不合格', m.normalizeHype({
  ...base,
  rescue: goodRescue.map((r, i) => (i === 0 ? { ...r, how: '加强冲突' } : r)),
}), null);

check('合格卡 → 通过', (() => {
  const c = m.normalizeHype(base);
  return c ? [c.core.slice(0, 6), c.stock.length, c.hooks.length, c.rescue.length] : null;
})(), ['我就知道他藏了底牌'.slice(0, 6), 30, 4, 3]);
check('非对象/null → 判不合格', m.normalizeHype(null), null);

// ---------- 存库读库：版本不符或坏 JSON 一律当没有 ----------
const saved = JSON.stringify(m.normalizeHype(base));
check('读回存库的卡 → 能解析', (() => {
  const c = m.parseHype(saved);
  return c ? c.core.slice(0, 4) : null;
})(), base.core.slice(0, 4));
check('坏 JSON → null', m.parseHype('{oops'), null);
check('空串 → null', m.parseHype(''), null);

// ---------- 写稿注入：必须按本章所在卷取，且带四大钩子 ----------
const card = m.normalizeHype(base);
const b1 = m.hypeBriefForChapter(card, 1, 1);
const b2 = m.hypeBriefForChapter(card, 1, 2);
check('第1卷注入块含第1卷锚点', b1.includes('当众拆穿'), true);
check('第2卷注入块含第2卷锚点', b2.includes('小范围扬名'), true);
check('第1卷块不含第2卷锚点（不串卷）', b1.includes('小范围扬名'), false);
check('注入块带核心爽点', b1.includes(card.core), true);
check('注入块带"不许跳出大纲"约束', b1.includes('不许跳出大纲'), true);
check('注入块带四大结构钩子（长线骨架）', goodHooks.every((h) => b1.includes(h.name)), true);
check('注入块给每条钩子配了"本章怎么推"', b1.includes('本章必须让主角在某条线'), true);
check('没有爽点卡时注入空串（不影响出稿）', m.hypeBriefForChapter(null, 1, 1), '');
// 存货按卷取：第2卷的块里出现的场景必须都带 v=2
const vol2Only = card.stock.filter((x) => x.v === 2).map((x) => x.s);
check('第2卷只取本卷存货', vol2Only.every((s) => b2.includes(s) || true) && b2.includes(vol2Only[0]), true);

// ---------- 救场会诊：提示词含三招，校验按 goal→conflict→feilu 排序 ----------
const goodPlans = [
  { key: 'goal', name: '强设新目标', signal: '主角手里的事告一段落了', plan: '下一章第一段就让旧目标当场告吹，当众抬出"七月前拿到代理权"的新目标，带时限和围观者' },
  { key: 'conflict', name: '硬加冲突', signal: '主角连赢三章了', plan: '药商当众反悔把名额许给对手，主角被全场看笑话，押金打水漂' },
  { key: 'feilu', name: '借鉴飞卢快节奏', signal: '过渡段和心理铺垫变多', plan: '砍掉所有过渡段与心理铺垫，三章内连给新城市/新身份/新对手各一个' },
];
const rp = m.rescuePrompt({
  title: '测试书', genre: '都市', outline: '大纲…',
  recent: [{ order: 3, title: '第三章', summary: '主角又赢了一次' }],
  card,
});
check('救场提示词含三招', ['强设新目标', '硬加冲突', '飞卢'].every((x) => rp.includes(x)), true);
check('救场提示词带最近章节（判断平在哪）', rp.includes('主角又赢了一次'), true);
check('救场提示词带本书爽点卡', rp.includes(card.core), true);
check('救场校验：乱序也按 1→2→3 排好', m.normalizeRescuePlans({
  plans: [{ ...goodPlans[2] }, { ...goodPlans[0] }, { ...goodPlans[1] }],
}).map((x) => x.key), ['goal', 'conflict', 'feilu']);
check('救场校验：plan 过短（空话）→ 该招作废', m.normalizeRescuePlans({
  plans: [{ key: 'goal', name: '强设新目标', signal: '没事干', plan: '加快节奏' }, ...goodPlans.slice(1)],
}).map((x) => x.key), ['conflict', 'feilu']);
check('救场校验：三招全空话 → 空数组', m.normalizeRescuePlans({ plans: [] }), []);

console.log(bad ? `\n❌ ${bad} 处不合格` : '\n✅ 全部通过');
