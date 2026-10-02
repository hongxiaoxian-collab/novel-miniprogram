// 列出服务器上的作品，重点看「改了名但大纲没跟着重出」的那几部
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const list = await fetch(BASE + '?platform=fanqie').then((r) => r.json()).catch(() => []);
for (const n of list) {
  const outLen = (n.outline || '').length;
  console.log([
    n.id,
    '《' + n.title + '》',
    '大纲' + outLen + '字',
    '脉络=' + (n.bibleStatus || '-'),
    '已选定书名=' + (n.dupAccepted || '无'),
    '任务=' + (n.jobStage || 'idle'),
  ].join(' | '));
}
