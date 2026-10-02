/**
 * Coze 六接口端到端联调自检。
 * 用法：node scripts/e2e-coze.mjs [fanqie|qimao]
 * 前置：后端已启动，且必须清掉沙箱代理，否则连不上 Coze：
 *   HTTPS_PROXY= HTTP_PROXY= https_proxy= http_proxy= node dist/main.js
 * 可用环境变量：BASE（默认 http://127.0.0.1:3001/novel）、WORDS（测试章目标字数，默认 600，省额度）
 *
 * ⚠️ 踩过的坑：BASE 默认是本机 127.0.0.1。如果本机也跑着一个旧的后端（很常见），
 *    脚本就会静默地测「本机的旧代码」，看起来像测试服挂了（finalize 404 之类）。
 *    部署自检时必须显式指定远程：BASE=http://120.79.174.44:3001/novel
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3001/novel';
const PLATFORM = process.argv[2] ?? 'fanqie';
const WORDS = Number(process.env.WORDS ?? 600);

console.log(`▶ 目标后端：${BASE}`); // 先打印目标，避免测错服务器还以为在测远程

let novelId = null;
let chapterId = null;
let bibleTitle = '';
const results = [];

async function api(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${raw.slice(0, 200)}`);
  return { data: raw ? JSON.parse(raw) : null, ms: Date.now() - t0 };
}

async function step(name, fn) {
  process.stdout.write(`▶ ${name} ... `);
  try {
    const note = await fn();
    results.push({ name, pass: true, note });
    console.log(`✅ ${note}`);
  } catch (e) {
    results.push({ name, pass: false, err: e.message });
    console.log(`❌ ${e.message}`);
  }
}

const needNovel = () => {
  if (!novelId) throw new Error('前置步骤未通过，跳过');
};

await step('1/6 recommend-topic 题材推荐', async () => {
  const { data, ms } = await api('POST', '/recommend-topic', { platform: PLATFORM });
  if (!data?.topics?.length) throw new Error('topics 为空数组');
  return `${ms}ms | ${data.topics.join(' / ')}`;
});

await step('2/6 outline 建作品 + 作品名/大纲', async () => {
  const created = await api('POST', '/', {
    platform: PLATFORM,
    title: '联调测试作品',
    genre: '都市',
    targetReader: '男频',
    chapterWords: WORDS,
  });
  novelId = created.data.id;
  const { data, ms } = await api('POST', `/${novelId}/outline`, {});
  if (!data?.outline && !data?.title) throw new Error('title 与 outline 均为空');
  return `${ms}ms | 《${data.title}》卖点：${(data.sellPoint ?? '(无)').slice(0, 40)}`;
});

await step('3/6 finalize 定版任务链（查重→脉络→资料→黄金章）', async () => {
  needNovel();
  const t0 = Date.now();
  const poll = async () => {
    let p = (await api('GET', `/${novelId}/progress`)).data;
    for (let i = 0; i < 240; i++) {
      if (p.stage === 'done' || p.stage === 'failed') break;
      await new Promise((r) => setTimeout(r, 3000));
      p = (await api('GET', `/${novelId}/progress`)).data;
    }
    return p;
  };
  const started = await api('POST', `/${novelId}/finalize`, {});
  if (!started.data?.steps?.length) throw new Error('finalize 未返回任务步骤（应异步立即返回）');
  let p = await poll();
  // 【新行为】严重撞车会「中断定版」而不是闷头生成（DUP_HIGH）。
  // 联调用的临时作品撞车概率很高，这里自动带 acceptDup 重试，模拟作者看过报告后选择"仍要定版"。
  let dupRetry = '';
  if (p.stage === 'failed' && String(p.error || '').includes('DUP_HIGH')) {
    dupRetry = '（查重判为严重撞车 → 自动 acceptDup 重试）';
    await api('POST', `/${novelId}/finalize`, { acceptDup: true });
    p = await poll();
  }
  const failed = (p.steps ?? []).find((s) => s.status === 'failed');
  if (p.stage !== 'done') throw new Error(`任务未完成：stage=${p.stage} ${p.error || failed?.error || ''}`);
  const { data } = await api('GET', `/${novelId}/bible`);
  const bible = data?.bible ?? {};
  const vols = bible.volumes?.length ?? 0;
  const keys = bible.keyChapters?.length ?? 0;
  if (!vols) throw new Error(`volumes 为空（分卷时间线未生成）bibleStatus=${data?.bibleStatus}`);
  bibleTitle = bible.volumes[0]?.name || bible.volumes[0]?.arc || '';
  return `${Date.now() - t0}ms | ${vols} 卷 | 关键节点章 ${keys} 个 | 黄金章 ${p.chapterCount} 章 | 首卷《${bibleTitle}》${dupRetry}`;
});

await step('4/6 chapter 生成正文', async () => {
  needNovel();
  const { data, ms } = await api('POST', `/${novelId}/chapter`, {
    instruction: '开篇：主角觉醒金手指，第一章结尾留悬念钩子',
    wordCount: WORDS,
  });
  chapterId = data.id;
  if (!data?.content) throw new Error('content 为空');
  return `${ms}ms | 《${data.title}》正文 ${data.content.length} 字`;
});

await step('5/6 rewrite 按原因重写本章', async () => {
  needNovel();
  if (!chapterId) throw new Error('前置步骤未通过，跳过');
  const { data, ms } = await api('POST', `/${novelId}/chapter/${chapterId}/rewrite`, {
    reason: '开篇节奏太慢，前300字不够抓人',
  });
  if (!data?.content) throw new Error('content 为空');
  return `${ms}ms | 重写后 ${data.content.length} 字`;
});

await step('6/6 author-assist 笔名推荐(≥3) + 作者简介', async () => {
  const pen = await api('POST', '/author-assist', { platform: PLATFORM, kind: 'pen', genre: '都市' });
  const pens = pen.data?.pens ?? [];
  if (pens.length < 3) throw new Error(`笔名候选不足 3 个：${JSON.stringify(pens)}`);
  const intro = await api('POST', '/author-assist', { platform: PLATFORM, kind: 'intro', genre: '都市' });
  if (!intro.data?.intro) throw new Error('作者简介为空');
  return `${pen.ms}ms | 笔名 ${pens.length} 个（${pens.slice(0, 3).join(' / ')}）| 简介 ${intro.data.intro.length} 字`;
});

const pass = results.filter((r) => r.pass).length;
results.filter((r) => !r.pass).forEach((r) => console.log(`  失败：${r.name} → ${r.err}`));
// 清理本次的测试作品（含章节，级联删除），避免测试库堆垃圾
if (novelId) {
  try {
    await api('DELETE', `/${novelId}`);
    console.log(`已清理测试作品 id=${novelId}`);
  } catch (e) {
    console.log(`清理测试作品失败（可忽略）：${e.message}`);
  }
}
console.log(`\n===== 结果：${pass}/${results.length} 通过 =====`);
if (pass < results.length) process.exit(1);
