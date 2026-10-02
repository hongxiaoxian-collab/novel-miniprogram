// 排查「点推荐书名 → 失败」：在不碰作者作品的前提下复现整条链路
// 1) 建一部临时作品  2) PUT 改名(带 dupAccepted)  3) 启动 outline 后台任务  4) 打印每一步的真实报错
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';

async function j(u, m, b) {
  const r = await fetch(BASE + u, {
    method: m || 'GET',
    headers: { 'content-type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  let o = null;
  try { o = JSON.parse(t); } catch (e) { /* 非 JSON */ }
  return { status: r.status, o, t };
}

const created = await j('', 'POST', { platform: 'fanqie', title: '探针临时作品-勿用', genre: '都市' });
console.log('1) 建作品 →', created.status, JSON.stringify(created.o || created.t).slice(0, 160));
const id = created.o && created.o.id;
if (!id) process.exit(1);

const up = await j('/' + id, 'PUT', { title: '探针改名测试', dupAccepted: '探针改名测试' });
console.log('2) PUT 改名(带 dupAccepted) →', up.status, JSON.stringify(up.o || up.t).slice(0, 300));

const job = await j('/' + id + '/jobs', 'POST', { kind: 'outline', opinion: '测试：极简大纲' });
console.log('3) 启动 outline 任务 →', job.status, JSON.stringify(job.o || job.t).slice(0, 300));

if (job.o && job.o.stage) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const p = await j('/' + id + '/jobs');
    if (p.o.stage !== 'running') {
      console.log('4) 任务结束 →', p.o.stage, JSON.stringify(p.o.steps || []).slice(0, 300), '错误：' + (p.o.error || '无'));
      break;
    }
    if (i % 4 === 0) console.log('   ...' + p.o.doneCount + '/' + p.o.total + ' ' + (p.o.current || ''));
  }
}

const del = await j('/' + id, 'DELETE');
console.log('5) 清理临时作品 →', del.status);
