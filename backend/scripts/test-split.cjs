/*
 * 封面断行单测：验证「有标点断在标点」「无标点长书名交给模型」「拼回必须一致」。
 * 用法（backend 目录下）：node scripts/test-split.cjs
 * 会自动把 cover-image.ts 编到 .tmp-split/（已在 .gitignore 里）再跑断言。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.tmp-split');
const JS = path.join(OUT, 'cover-image.js');
execSync(
  `npx tsc src/novel/cover-image.ts --outDir "${OUT}" --module commonjs --target es2020 --skipLibCheck`,
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
);
if (!fs.existsSync(JS)) throw new Error('编译 cover-image.ts 失败');
const m = require(JS);

const titles = [
  '高考前三天：我靠邮票IC卡造出中国芯',
  '实习生拿祖传针救了首富',
  '外卖小哥的银针局',
  '都市神医归来震江湖',
  '重生1998：从摆地摊到首富',
  '我在诸天万界当房东',
  '穿书后我成了反派的亲妈',
  '开局签到十万亿灵石',
];

let bad = 0;
for (const t of titles) {
  const needAi = m.titleNeedsAiSplit(t);
  const auto = m.splitTitle(t);
  console.log(
    `${t}\n  需AI断行=${needAi}  自动断=[${auto.join(' | ')}]`,
  );
  if (!needAi) {
    const joined = (auto[0] + (auto[1] || '')).replace(/[\s：:，,、·！!？?。.－\-—|｜「」“”"']/g, '');
    const want = t.replace(/[\s：:，,、·！!？?。.－\-—|｜「」“”"']/g, '');
    if (joined !== want) { console.log('   !! 拼回不一致'); bad++; }
  }
}

// normalizeCoverLines 的校验：拼回不一致必须判 null
const cases = [
  [['都市神医归来', '震江湖'], '外卖小哥的银针局', null],
  [['都市神医归来', '震江湖'], '都市神医归来震江湖', ['都市神医归来', '震江湖']],
  [['实习生拿祖传', '针救了首富'], '实习生拿祖传针救了首富', ['实习生拿祖传', '针救了首富']],
  [['祖', '传'], '祖传', ['祖', '传']],          // 短名单行两字：允许
  [['我', '在诸天万界当房东'], '我在诸天万界当房东', null], // 长书名出 1 字行：拒绝
  [['外卖小哥的银针局'], '外卖小哥的银针局', ['外卖小哥的银针局']],
];
for (const [lines, title, want] of cases) {
  const got = m.normalizeCoverLines(lines, title);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`normalize(${JSON.stringify(lines)}, ${title}) => ${JSON.stringify(got)} ${ok ? 'OK' : 'FAIL want ' + JSON.stringify(want)}`);
}
console.log(bad ? `\n❌ ${bad} 处不合格` : '\n✅ 全部通过');
