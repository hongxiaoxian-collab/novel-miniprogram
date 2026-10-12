/*
 * 配额单测：证明「VIP 按平台各算一份、免费/游客两平台共享一份」这两条规则真的生效。
 * 用法（backend 目录下）：node scripts/test-quota.cjs
 * 会自动把 quota.ts / plan.ts 编到 .tmp-quota/（已 gitignore）再跑断言。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.tmp-quota');
execSync(
  `npx tsc src/auth/quota.ts --outDir "${OUT}" --module commonjs --target es2020 --skipLibCheck`,
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
);
// tsc 以 src/auth 为根 → 输出是平铺的 .tmp-quota/quota.js
const QUOTA = fs.existsSync(path.join(OUT, 'quota.js'))
  ? path.join(OUT, 'quota.js')
  : path.join(OUT, 'auth', 'quota.js');
if (!fs.existsSync(QUOTA)) throw new Error('编译 quota.ts 失败');
const m = require(QUOTA);

/**
 * 造一个假库：按平台给出今日章节。
 * @param chapters {平台: 计入额度的章节数}
 * @param freeChapters {平台: 开书自带(quotaFree)的章节数} —— 这些不该被算进额度
 * 假库必须**真的按 where 过滤**（第一版没过滤，把 quotaFree 的 bug 盖过去了）。
 */
function fakeDb({ level = 'free', chapters = {}, freeChapters = {} } = {}) {
  const rows = [];
  const push = (platform, n, quotaFree) => {
    for (let i = 0; i < n; i++) rows.push({ content: 'x'.repeat(2000), quotaFree, novel: { platform } });
  };
  Object.entries(chapters).forEach(([p, n]) => push(p, n, false));
  Object.entries(freeChapters).forEach(([p, n]) => push(p, n, true));
  return {
    user: { findUnique: async () => ({ id: 'u1', level, vipExpireAt: null, quotaJson: null }) },
    novel: { count: async () => 0, findMany: async () => [] },
    chapter: {
      findMany: async ({ where } = {}) => rows.filter(
        (r) => !(where && where.quotaFree === false && r.quotaFree !== false),
      ),
    },
  };
}

let bad = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name} → ${got}${ok ? '' : `（期望 ${want}）`}`);
};
const isDeny = async (p) => (await p) !== null;

(async () => {
  // ---------- VIP：番茄、七猫各一份 ----------
  const vip = await m.currentQuota(
    fakeDb({ level: 'vip', chapters: { fanqie: 4, qimao: 0 } }), 'u1', null, 'fanqie',
  );
  check('VIP 番茄已写 4 章（perPlatform）', vip.perPlatform, true);
  check('VIP 番茄口径 = 4 章', vip.chapters, 4);
  check('VIP 番茄已达上限 → 拦住', await isDeny(m.checkChapterLimit(vip, 1, 'fanqie')), true);

  const vipQ = await m.currentQuota(
    fakeDb({ level: 'vip', chapters: { fanqie: 4, qimao: 0 } }), 'u1', null, 'qimao',
  );
  check('VIP 七猫口径 = 0 章（不吃番茄的账）', vipQ.chapters, 0);
  check('VIP 番茄写满后七猫仍可写 → 放行', await isDeny(m.checkChapterLimit(vipQ, 1, 'qimao')), false);

  const vipWords = await m.currentQuota(
    fakeDb({ level: 'vip', chapters: { fanqie: 5, qimao: 0 } }), 'u1', null, 'qimao',
  );
  check('VIP 字数也按平台：七猫已写 0 字', vipWords.words, 0);

  // ---------- 免费：两平台共享 ----------
  const free = await m.currentQuota(
    fakeDb({ level: 'free', chapters: { fanqie: 1, qimao: 1 } }), 'u1', null, 'fanqie',
  );
  check('免费版 perPlatform=false', free.perPlatform, false);
  check('免费版两平台合计 = 2 章', free.chapters, 2);
  check('免费版合计 4000 字 = 2 章 × 2000', free.words, 4000);
  check('免费版在番茄再写 1 章 → 拦住（共享额度）', await isDeny(m.checkChapterLimit(free, 1, 'fanqie')), true);
  check('免费版在七猫再写 1 章 → 同样拦住', await isDeny(m.checkChapterLimit(free, 1, 'qimao')), true);

  const freeHalf = await m.currentQuota(
    fakeDb({ level: 'free', chapters: { fanqie: 1, qimao: 0 } }), 'u1', null, 'qimao',
  );
  check('免费版写了 1 章后还能再写 1 章 → 放行', await isDeny(m.checkChapterLimit(freeHalf, 1, 'qimao')), false);
  check('免费版字数上限 4000', freeHalf.limits.dailyWords, 4000);
  check('免费版章数上限 2', freeHalf.limits.dailyChapters, 2);

  // ---------- 游客：共享，1 章 ----------
  const guest = await m.currentQuota(fakeDb({ chapters: { fanqie: 1 } }), null, 'g1', 'qimao');
  check('游客 perPlatform=false', guest.perPlatform, false);
  check('游客番茄写了 1 章 → 七猫也拦住', await isDeny(m.checkChapterLimit(guest, 1, 'qimao')), true);

  // ---------- 开书自带的黄金三章不占日更额度 ----------
  const afterOpen = await m.currentQuota(
    fakeDb({ level: 'vip', chapters: {}, freeChapters: { qimao: 3 } }), 'u1', null, 'qimao',
  );
  check('一键开书写出的 3 章不计入额度', afterOpen.chapters, 0);
  check('开书后当天仍能续更 4 章 → 放行', await isDeny(m.checkChapterLimit(afterOpen, 1, 'qimao')), false);

  const freeAfterOpen = await m.currentQuota(
    fakeDb({ level: 'free', chapters: {}, freeChapters: { fanqie: 3 } }), 'u1', null, 'fanqie',
  );
  check('免费版开完书也不会被锁死（0/2 章）', freeAfterOpen.chapters, 0);
  check('免费版开书后仍能续更 → 放行', await isDeny(m.checkChapterLimit(freeAfterOpen, 1, 'fanqie')), false);

  const withReal = await m.currentQuota(
    fakeDb({ level: 'vip', chapters: { qimao: 2 }, freeChapters: { qimao: 3 } }), 'u1', null, 'qimao',
  );
  check('续更的章节照常计入（2 章）', withReal.chapters, 2);

  // ---------- 包月套餐数值 ----------
  check('VIP 每平台 4 章', vip.limits.dailyChapters, 4);
  check('VIP 每平台 1 万字', vip.limits.dailyWords, 10000);
  check('VIP 每平台 1 本新书', vip.limits.dailyNewNovels, 1);

  // ---------- 每天新书限额的口径 ----------
  // 假库必须真的按 where.platform 过滤，否则测不出"各算一份" —— 第一版就是这里漏了，
  // 结果两条断言都返回同一批行，把 bug 盖过去。
  const fakeNovelDb = (byPlatform) => ({
    novel: {
      findMany: async ({ where } = {}) => {
        const p = where && where.platform;
        const n = p ? (byPlatform[p] || 0) : (byPlatform._shared || 0);
        return Array.from({ length: n }, (_, i) => ({ id: 'n' + i }));
      },
    },
  });
  check(
    'VIP 番茄今天已开 1 本 → 再开拦住',
    await isDeny(m.checkNewNovelPerDay(fakeNovelDb({ fanqie: 1 }), 'u1', null, 1, true, 'fanqie')),
    true,
  );
  check(
    'VIP 七猫今天还能开（各算一份）→ 放行',
    await isDeny(m.checkNewNovelPerDay(fakeNovelDb({ fanqie: 1 }), 'u1', null, 1, true, 'qimao')),
    false,
  );
  check(
    '免费版共享：番茄已开 1 本 → 七猫也拦住',
    await isDeny(m.checkNewNovelPerDay(fakeNovelDb({ _shared: 1 }), 'u1', null, 1, false, 'qimao')),
    true,
  );

  console.log(bad ? `\n❌ ${bad} 项不合格` : '\n✅ 配额规则全部通过');
  process.exit(bad ? 1 : 0);
})();
