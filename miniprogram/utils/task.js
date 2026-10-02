const { request } = require('./request');

/** 定版任务各阶段展示文案（与后端 FINALIZE_STEPS 对应） */
const STAGE_TEXT = {
  dup: '查重 · 比对番茄/七猫热榜',
  bible: '生成全书脉络 + 分卷时间线',
  publish: '生成上架资料（简介 / 标签）',
  golden: '写黄金 1-3 章',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动定版任务链并轮询进度。
 * 长任务（查重+脉络+资料+黄金三章，约 2-6 分钟）不能靠单次请求等待：
 * 小程序 wx.request 默认 60 秒超时，会把「其实已经生成成功」误报成失败。
 * @param {(p:any)=>void} onProgress 每次拿到新进度时回调
 */
async function runFinalize(id, body, onProgress) {
  await request(`/novel/${id}/finalize`, 'POST', body || {});
  const deadline = Date.now() + 12 * 60 * 1000; // 最长等 12 分钟
  while (Date.now() < deadline) {
    await sleep(3000);
    const p = await request(`/novel/${id}/progress`);
    if (onProgress) onProgress(p);
    if (p.stage === 'done') return p;
    if (p.stage === 'failed') {
      const err = new Error(p.error || '任务执行失败');
      err.progress = p;
      throw err;
    }
  }
  throw new Error('任务超时，请稍后回作品页查看进度');
}

/** 当前正在跑的步骤文案（给 loading 用） */
function runningText(steps) {
  const cur = (steps || []).find((s) => s.status === 'running');
  return cur ? STAGE_TEXT[cur.stage] || cur.label : '准备中…';
}

/**
 * 通用后台任务（体检 / 自动修复 / 续更 / 出大纲）：后端把任务状态落库，前端只轮询进度。
 * 这样即使用户退出小程序，服务端照样把活干完；再进来还能看到跑到哪一步。
 * @param {'audit'|'fix'|'chapter'|'outline'} kind
 * @param {object} opts opinion=作者选定的方向 / wordCount / instruction / maxMs
 */
async function runJob(id, kind, onProgress, opts) {
  const o = opts || {};
  // 同一部作品同时只能跑一个任务：先看看有没有在跑的，有就等它结束再排自己的，
  // 否则后端直接回「已有一个任务在跑」，作者看到的就是一句没头没尾的"失败"
  try {
    const cur = await request(`/novel/${id}/jobs`);
    if (cur && cur.stage === 'running') {
      const waitEnd = Date.now() + 5 * 60 * 1000;
      while (Date.now() < waitEnd) {
        await sleep(2500);
        const p = await request(`/novel/${id}/jobs`);
        if (onProgress && p.total) onProgress({ ...p, current: `排队中（上一个任务：${p.current || '进行中'}）` });
        if (p.stage !== 'running') break;
      }
    }
  } catch (e) { /* 查不到就当作空闲，照常启动 */ }
  await request(`/novel/${id}/jobs`, 'POST', {
    kind,
    opinion: o.opinion || undefined,
    wordCount: o.wordCount || undefined,
    instruction: o.instruction || undefined,
    count: o.count || undefined, // chapter：一次续更几章
    force: o.force ? true : undefined,
  });
  const maxMs = (opts && opts.maxMs) || 20 * 60 * 1000; // 逐章修复可能很久，给 20 分钟
  const deadline = Date.now() + maxMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(2500);
    last = await request(`/novel/${id}/jobs`);
    if (onProgress) onProgress(last);
    if (last.stage === 'done') return last;
    if (last.stage === 'failed') {
      const err = new Error(last.error || '任务执行失败');
      err.job = last;
      throw err;
    }
  }
  const err = new Error('任务仍在后台运行，稍后回来查看');
  err.job = last;
  throw err;
}

/** 进度文案：如「修复第 2 章（3 处） 2/5」 */
function jobText(job) {
  if (!job) return '准备中…';
  if (job.stage === 'done') return '已完成';
  if (job.stage === 'failed') return '失败';
  const cur = job.current || '启动中…';
  return job.total ? `${cur}（${job.doneCount}/${job.total}）` : cur;
}

/** 进度百分比 0-100（进度条用）：按已完成步骤数算，跑中那一步算半步，避免条子长时间不动 */
function pctOf(steps) {
  const list = steps || [];
  if (!list.length) return 0;
  const done = list.filter((s) => s.status === 'done').length;
  const running = list.some((s) => s.status === 'running') ? 0.5 : 0;
  return Math.min(99, Math.round(((done + running) / list.length) * 100));
}

/**
 * 统一的进度卡数据：所有长任务（体检 / 定稿 / 续写 / 出大纲 / 撞车修复）都用它渲染同一根进度条。
 * @param {string} title 任务名，如「一键体检」
 * @param {object} p 后端返回的进度 {steps, current, doneCount, total, stage}
 */
function progOf(title, p) {
  const steps = (p && p.steps) || [];
  const done = steps.filter((s) => s.status === 'done').length;
  return {
    show: true,
    title,
    pct: (p && p.stage === 'done') ? 100 : pctOf(steps),
    done,
    total: steps.length,
    current: (p && p.current) || '',
    steps,
    stage: (p && p.stage) || 'running',
  };
}

module.exports = { runFinalize, runningText, runJob, jobText, pctOf, progOf, STAGE_TEXT };
