/**
 * 账号状态（登录态 / 等级 / 配额）。
 * 作品页顶部和「我的」页都要显示同一份数据，抽出来保证两处永远一致，
 * 不会出现"作品页说还能建 2 本、我的页说 0 本"这种对不上。
 */
const { request } = require('./request');

/** 把 /auth/me 的返回整形成界面能直接绑定的形状 */
function shapeMe(r) {
  const d = r || {};
  const limits = d.limits || {};
  const usage = d.usage || {};
  return {
    loggedIn: !!d.loggedIn,
    guest: !!d.guest,
    openidMasked: (d.me && d.me.openidMasked) || '',
    createdAt: (d.me && d.me.createdAt) || '',
    vipExpireAt: (d.me && d.me.vipExpireAt) || '',
    planName: (d.plan && d.plan.name) || '普通版',
    planCode: (d.plan && d.plan.code) || 'free',
    maxNovels: limits.maxNovels || 0,
    activePerPlatform: limits.activePerPlatform || 1,
    dailyChapters: limits.dailyChapters || 0,
    dailyWords: limits.dailyWords || 0,
    wordPerChapter: limits.wordPerChapter || 0,
    // 各平台在写数量：{fanqie:1, qimao:0} —— 每平台最多 1 部，界面直接显示"番茄 1/1"
    active: d.active || {},
    // 今天还能写多少字（每天 1 万字）
    wordsLeft: Math.max(0, (limits.dailyWords || 0) - (usage.words || 0)),
    // 游客/低等级不给调每章字数，界面据此隐藏输入框并给出说明
    canEditWords: limits.chapterWordsEditable !== false,
    auditFullScan: !!limits.auditFullScan,
    novels: d.novelCount || 0,
    chapters: usage.chapters || 0,
    words: usage.words || 0,
    upsell: d.upsell || '',
    // 首次向导：未走过就强制先走一遍（下载 App → 注册 → 实名 → 笔名 → 未签约）
    onboard: d.onboard || { onboarded: false, steps: {}, penName: '' },
  };
}

async function loadMe() {
  const r = await request('/auth/me');
  return shapeMe(r);
}

/** 主动登录。成功返回 {ok:true, claimed}；失败返回 {ok:false, msg}（msg 可直接 toast） */
function loginNow() {
  const app = typeof getApp === 'function' ? getApp() : null;
  if (!app || !app.loginNow) return Promise.resolve({ ok: false, msg: '登录不可用' });
  return app.loginNow();
}

module.exports = { shapeMe, loadMe, loginNow };
