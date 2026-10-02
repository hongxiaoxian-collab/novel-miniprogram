/**
 * 封面绘制验证器（第 1 步）：
 * 把 miniprogram/pages/intro/intro.js 里真实的 paint() 跑一遍，
 * 用一个「录制型 ctx」把全部画布调用记下来，输出 JSON。
 * 第 2 步由 replay_cover.py 按调用重放成 PNG，看到的就是小程序里的真实像素。
 * 用法：node record_cover.js <输出json>
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const OUT = process.argv[2] || 'cover_log.json';

// ---- 桩：小程序全局 ----
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  showToast: () => {},
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }) }),
};
global.getApp = () => ({ globalData: {} });
global.Page = (o) => { global.__page = o; };

// utils 里的模块都不是本次要验证的，统一返回空实现
const origRequire = Module.prototype.require;
Module.prototype.require = function (p) {
  // utils/cover 是本次要验证的真实绘制零件（道具/场景），必须用真模块；
  // 其余 utils（请求、缓存、剪贴板…）与封面无关，统一空实现。
  if (String(p).indexOf('utils/cover') >= 0) return origRequire.apply(this, [p]);
  if (String(p).indexOf('utils/') >= 0) return new Proxy({}, { get: () => () => {} });
  return origRequire.apply(this, [p]);
};

const INTRO_JS = process.env.INTRO_JS
  || 'C:/Users/53430/WorkBuddy/小说小程序/miniprogram/pages/intro/intro.js';
require(INTRO_JS);
const page = global.__page;

// ---- 文字宽度估算：贴近 PIL/微信的常见中文字体度量 ----
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (code > 0x2e80) w += size;                    // 全角汉字/标点
    else if (/[iIl1.,:;'!|]/.test(ch)) w += size * 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += size * 0.6;
    else w += size * 0.5;
  }
  return w * (bold ? 1.02 : 1);
}

// ---- 录制型 canvas 上下文 ----
function makeCtx(log) {
  let font = '20px sans-serif';
  let bold = false;
  let size = 20;
  const parseFont = (f) => {
    bold = /\bbold\b/.test(f);
    const m = /(\d+(?:\.\d+)?)px/.exec(f);
    size = m ? parseFloat(m[1]) : 20;
  };
  return {
    get font() { return font; },
    set font(v) { font = v; parseFont(v); log.push({ p: 'font', v }); },
    set fillStyle(v) { log.push({ p: 'fillStyle', v }); },
    set strokeStyle(v) { log.push({ p: 'strokeStyle', v }); },
    set lineWidth(v) { log.push({ p: 'lineWidth', v }); },
    set textAlign(v) { log.push({ p: 'textAlign', v }); },
    set textBaseline(v) { log.push({ p: 'textBaseline', v }); },
    set shadowColor(v) { log.push({ p: 'shadowColor', v }); },
    set shadowBlur(v) { log.push({ p: 'shadowBlur', v }); },
    set globalAlpha(v) { log.push({ p: 'globalAlpha', v }); },
    beginPath() { log.push({ m: 'beginPath' }); },
    closePath() { log.push({ m: 'closePath' }); },
    moveTo(x, y) { log.push({ m: 'moveTo', a: [x, y] }); },
    lineTo(x, y) { log.push({ m: 'lineTo', a: [x, y] }); },
    quadraticCurveTo(a, b, c, d) { log.push({ m: 'quadraticCurveTo', a: [a, b, c, d] }); },
    bezierCurveTo(a, b, c, d, e, f) { log.push({ m: 'bezierCurveTo', a: [a, b, c, d, e, f] }); },
    arc(x, y, r, s, e, ccw) { log.push({ m: 'arc', a: [x, y, r, s, e, !!ccw] }); },
    rect(x, y, w, h) { log.push({ m: 'rect', a: [x, y, w, h] }); },
    fill() { log.push({ m: 'fill' }); },
    stroke() { log.push({ m: 'stroke' }); },
    fillRect(x, y, w, h) { log.push({ m: 'fillRect', a: [x, y, w, h] }); },
    strokeRect(x, y, w, h) { log.push({ m: 'strokeRect', a: [x, y, w, h] }); },
    fillText(t, x, y) { log.push({ m: 'fillText', a: [t, x, y] }); },
    measureText(t) { return { width: textWidth(t, size, bold) }; },
    save() { log.push({ m: 'save' }); },
    restore() { log.push({ m: 'restore' }); },
    translate(x, y) { log.push({ m: 'translate', a: [x, y] }); },
    scale(x, y) { log.push({ m: 'scale', a: [x, y] }); },
    createLinearGradient(x0, y0, x1, y1) {
      const g = { type: 'linear', p: [x0, y0, x1, y1], stops: [] };
      g.addColorStop = (o, c) => g.stops.push([o, c]);
      return g;
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const g = { type: 'radial', p: [x0, y0, r0, x1, y1, r1], stops: [] };
      g.addColorStop = (o, c) => g.stops.push([o, c]);
      return g;
    },
  };
}

const cases = [
  { name: '都市男频', nov: { genre: '都市·重生', targetReader: '男频', title: '重生1998：我靠信息差躺成世界首富', penName: '青山不改', outline: '' } },
  { name: '古言女频', nov: { genre: '古言·宫斗', targetReader: '女频', title: '凤医九天', penName: '青山不改', outline: '' } },
  { name: '科幻', nov: { genre: '科幻·末世', targetReader: '男频', title: '星际拾荒者', penName: '青山不改', outline: '' } },
];

// 「按情节生成」的封面方案：这三组用来验证 plan 分支（场景 + 道具 + 人物造型 + 构图）真能画出图，
// 而不是像老模板那样只按题材套壳。
const planCases = [
  {
    name: '情节·县城收书',
    nov: { genre: '都市·重生', targetReader: '男频', title: '重生1998：我靠信息差躺成世界首富', penName: '青山不改' },
    plan: {
      sceneType: 'county', layout: 'center', props: ['books', 'sign', 'bike'],
      figure: { type: 'modern', gender: 'male', hair: 'short', outfit: 'worker', pose: 'hold' },
      palette: { bg: ['#1b2233', '#4a5a78'], accent: '#ffd77a', cloth: '#22303f', inner: '#e8edf5', skin: '#eccfae', hair: '#14161d' },
      horizon: 0.68, heroScale: 0.98, scene: '县城废品收购站前，年轻人抱着旧连环画回头', mood: '市井 翻身',
    },
  },
  {
    name: '情节·古言宫斗',
    nov: { genre: '古言·宫斗', targetReader: '女频', title: '凤医九天', penName: '青山不改' },
    plan: {
      sceneType: 'indoor', layout: 'band', props: ['lantern', 'sword'],
      figure: { type: 'ancient', gender: 'female', hair: 'bun', outfit: 'robe', pose: 'look' },
      palette: { bg: ['#3a1220', '#a0526d'], accent: '#ffc2d4', cloth: '#4a1230', inner: '#f6e7ef', skin: '#f4d6bb', hair: '#1c1220' },
      horizon: 0.62, heroScale: 0.94, scene: '深宫檐下提着灯笼回望的女医', mood: '隐忍 反击',
    },
  },
  {
    name: '情节·科幻星环',
    nov: { genre: '科幻·末世', targetReader: '男频', title: '星际拾荒者', penName: '青山不改' },
    plan: {
      sceneType: 'space', layout: 'side', props: ['ring', 'crate', 'pc'],
      figure: { type: 'sci', gender: 'male', hair: 'short', outfit: 'coat', pose: 'walk' },
      palette: { bg: ['#061428', '#10405e'], accent: '#55e6ff', cloth: '#0a1c2e', inner: '#d9f6ff', skin: '#e8cdb4', hair: '#101a26' },
      horizon: 0.72, heroScale: 1.02, scene: '废弃空间站里拖着回收箱的拾荒者', mood: '孤寂 冷硬',
    },
  },
];

const out = {};
cases.forEach((c) => {
  for (let seed = 0; seed < 6; seed++) {
    const log = [];
    const inst = Object.assign(Object.create(null), page, {
      data: { nov: c.nov, coverSeed: seed, platform: 'fanqie' },
      setData() {},
    });
    inst.paint(makeCtx(log), 600, 800);
    out[`${c.name}#${seed}`] = log;
  }
});
planCases.forEach((c) => {
  const log = [];
  const inst = Object.assign(Object.create(null), page, {
    data: { nov: c.nov, coverSeed: 0, platform: 'fanqie', coverPlan: c.plan, coverLayout: c.plan.layout },
    setData() {},
  });
  inst.paint(makeCtx(log), 600, 800);
  out[`${c.name}`] = log;
});
fs.writeFileSync(OUT, JSON.stringify(out));
const n = Object.values(out).reduce((s, l) => s + l.length, 0);
console.log(`已录制 ${Object.keys(out).length} 张封面，共 ${n} 条画布调用 → ${OUT}`);
