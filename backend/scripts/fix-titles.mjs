// 一次性数据修正：把历史上被存成《《XXX》》的双层书名号洗掉（书名本身不该带《》）
const BASE = process.env.BASE || 'http://120.79.174.44:3001/novel';
const clean = (t) => String(t || '').replace(/[《》<>【】\[\]]/g, '').replace(/^[\s"']+|[\s"']+$/g, '').trim();

const list = await fetch(BASE + '?platform=fanqie').then((r) => r.json()).catch(() => []);
for (const n of list) {
  const t = clean(n.title);
  const d = n.dupAccepted ? clean(n.dupAccepted) : '';
  if (t === n.title && d === (n.dupAccepted || '')) { console.log('跳过（已干净）《' + n.title + '》'); continue; }
  const r = await fetch(BASE + '/' + n.id, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(d ? { title: t, dupAccepted: d } : { title: t }),
  }).then((x) => x.json()).catch(() => null);
  console.log('已修正：《' + n.title + '》 → 《' + (r && r.title ? r.title : t) + '》', d ? '(锁定名同步)' : '');
}
