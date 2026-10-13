/**
 * 统计指纹自测：验证 aiFingerprint 能否把"AI 腔正文"判为不达标、把"人写参差正文"判为达标。
 * 运行：node scripts/test-deai.cjs（需先 npm run build 产出 dist/novel/deai.js）
 *
 * 负样本 = 2026-10-13 用户实测被朱雀判「AI 25.62% + 疑似 AI 74.38%」的那段正文。
 */
const { aiFingerprint, splitSentences, splitParagraphs } = require('../dist/novel/deai.js');

// 朱雀截图里的真实正文（AI 25.62% / 疑似 74.38% / 人工 0%）
const AI_SAMPLE = `"林陌，你今天还敢碰针？"周承一把揪了义诊桌上的白布，铜针飞到墙角，当啷响。

三月十五。社区义诊日。

我刚给赵婶按完腰，手还沾着药油。周承就堵在台前，胸口别着卫健委的临时袖标。

"你师徒关系早断了。"他声音拉得平，"我举报你非法行医。今早卫健委突击检查，你那些古法秘术没批文。"

围观的街坊一下子静了。

赵婶站出来，手叉腰："承娃子，你吃林陌的饭长大，如今咬他？"

"赵婶别护。"周承冷笑，"他藏的口诀是我师门丢的。今天必须离岗。"`;

// 人写样本：故意混入超长句 + 碎句 + 单句成段
const HUMAN_SAMPLE = `巷子口那盏路灯又闪了两下，然后，灭了。

林陌没动。

他手里还捏着那根铜针，针尖上凝着一小滴血，是赵婶的。风从巷子另一头灌进来，卷着垃圾堆的味道和远处大排档的油烟，混成一股说不上来的腥甜，钻进鼻子里，让他想起三年前师父咽气那晚，医院走廊里也是这个味儿——消毒水混着血，怎么洗都洗不掉。

"跑啊。"

有人喊。

可他能跑哪儿去。`;

function expect(name, cond) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}`);
  return cond;
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (expect(name, cond)) pass++;
  else fail++;
}

console.log('=== 负样本：朱雀判 AI 的正文 ===');
// 截图样本仅 210 字，低于默认 400 字阈值；测试里降阈值以验证判据本身
const ai = aiFingerprint(AI_SAMPLE, 100);
console.log('  指纹:', JSON.stringify(ai, null, 0));
check('应判为不达标（pass=false）', ai.pass === false);
check('句长标准差应偏低（<10，AI 区）', ai.stdDev < 10);
check('综合分应 <60', ai.score < 60);
check('应给出 ≥2 条短板', ai.deficits.length >= 2);

console.log('\n=== 正样本：人写参差正文 ===');
const hu = aiFingerprint(HUMAN_SAMPLE);
console.log('  指纹:', JSON.stringify(hu, null, 0));
check('句长标准差应更高（> 负样本）', hu.stdDev > ai.stdDev);
check('综合分应 > 负样本', hu.score > ai.score);

console.log('\n=== 边界 ===');
check('空文本 pass=true（不折腾）', aiFingerprint('').pass === true);
check('超短文本 pass=true', aiFingerprint('就一句话而已。').pass === true);
check('分句：句末标点后能切开', splitSentences('第一句。第二句！第三句？').length === 3);
check('分段：每个非空行一段', splitParagraphs('甲。\n\n乙。\n丙。').length === 3);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
