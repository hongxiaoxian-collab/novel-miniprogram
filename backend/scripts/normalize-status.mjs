/**
 * 一次性数据迁移（新架构上线后跑一次）：
 *  1. 老作品的 contractStatus 是 'signing'（旧默认值，含义模糊），统一改成 'unsigned'（未签约）。
 *     已经 'signed'（已签约）的不动 —— 那是作者自己标过的真实状态，不能替他改回去。
 *  2. status 为空的老作品补成 'writing'（在写）。
 * 只做这两件"补默认值"的事，不动任何作品的可见性：绝不因为升级让作者的书消失。
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const a = await p.novel.updateMany({
    where: { contractStatus: 'signing' },
    data: { contractStatus: 'unsigned' },
  });
  // status 字段是 NOT NULL + 有默认值，db push 时老行已自动补成 'writing'，不用再改

  // 【新架构】同一平台只留最新一部"在写"，更早的转"已归档"。
  // 绝不删除：归档作品在列表里仍然看得见、能导出、能转回在写 —— 升级不能让作者的书消失。
  let archived = 0;
  for (const plat of ['fanqie', 'qimao']) {
    const list = await p.novel.findMany({
      where: { platform: plat, status: 'writing' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    for (const n of list.slice(1)) {
      const r = await p.novel.update({ where: { id: n.id }, data: { status: 'archived' } });
      if (r) archived += 1;
    }
  }

  const rows = await p.novel.findMany({ select: { platform: true, status: true, contractStatus: true } });
  const byPlat = {};
  rows.forEach((r) => {
    const k = `${r.platform}/${r.status}`;
    byPlat[k] = (byPlat[k] || 0) + 1;
  });
  console.log(JSON.stringify({ unsignedPatched: a.count, archived, total: rows.length, byPlat }));
} finally {
  await p.$disconnect();
}
