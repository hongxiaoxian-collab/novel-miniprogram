/**
 * 撞车处置链路桩测试。
 * 覆盖：① 严重撞车时定版被拦下（不白跑几分钟）② 「仍要定版」才带 acceptDup
 *      ③ 点选推荐书名的闭环动作（改名 → 按差异化重出大纲 → 重新查重）
 *      ④ 后端 DUP_HIGH 中断定版时，不当成普通失败，而是拉回报告展示处置面板
 * 用法：node preview/verify_wizard_dup.js
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../miniprogram');
const PAGE = path.join(ROOT, 'pages/wizard/wizard.js');
const ID = 'DUPNOVEL0001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const calls = [];
const toasts = [];
const modals = [];
const navs = [];
const store = {};
let dupRisk = 'high';
let finalizeBehavior = 'done';

const dupReport = () => ({
  risk: dupRisk,
  riskNote: '与《重生1998之商海沉浮》（番茄 · 书名）高度相似',
  matches: [
    { title: '重生1998之商海沉浮', platform: '番茄', type: '书名', why: '同结构、同年份', similarity: '高' },
  ],
  titleAdvice: '建议换名',
  titleSuggestions: ['千禧年：我从地摊起家', '九八重启：第一桶金', '重回九零：风口猎手'],
  plotAdvice: '把开局金手指从"先知"改成"技术复盘"，避开雷同开局',
  verdict: '建议改名后再定版',
});

global.wx = {
  showLoading() {}, hideLoading() {},
  showToast(o) { toasts.push(o.title); },
  showModal(o) { modals.push(o); if (o.success) o.success({ confirm: true }); },
  setNavigationBarColor() {}, vibrateShort() {},
  setStorageSync(k, v) { store[k] = v; },
  getStorageSync(k) { return store[k]; },
  removeStorageSync(k) { delete store[k]; },
  navigateTo(o) { navs.push(o.url); },
};
global.getApp = () => ({ globalData: { platform: 'fanqie', novelId: '' } });

const reqPath = require.resolve(path.join(ROOT, 'utils/request.js'));
function fakeRequest(url, method = 'GET', data) {
  calls.push({ url, method, data });
  if (url.endsWith('/check-duplicate')) return Promise.resolve(dupReport());
  if (url.endsWith('/outline')) return Promise.resolve({ title: '千禧年：我从地摊起家', sellPoint: 's', outline: 'o' });
  if (url.endsWith('/finalize')) return Promise.resolve({});
  if (url.endsWith('/progress')) {
    return Promise.resolve(
      finalizeBehavior === 'dupHigh'
        ? { stage: 'failed', steps: [], error: 'DUP_HIGH｜严重撞车（与《重生1998之商海沉浮》雷同）。请换书名 / 按建议调情节 / 换题材重做大纲后再定版' }
        : { stage: 'done', steps: [] },
    );
  }
  if (method === 'GET' && url === `/novel/${ID}`) {
    return Promise.resolve({
      id: ID, title: '旧书名', bibleStatus: 'generating',
      dupReport: finalizeBehavior === 'dupHigh' ? JSON.stringify(dupReport()) : null,
    });
  }
  return Promise.resolve({ id: ID, title: '新名' });
}
require.cache[reqPath] = { id: reqPath, filename: reqPath, loaded: true, exports: { request: fakeRequest } };

let cfg = null;
global.Page = (c) => { cfg = c; };
require(PAGE);

const page = Object.assign({}, cfg);
page.data = JSON.parse(JSON.stringify(cfg.data));
page.setData = function (patch, cb) {
  Object.keys(patch).forEach((k) => {
    if (k.indexOf('.') > 0) {
      const [a, b] = k.split('.');
      this.data[a] = Object.assign({}, this.data[a], { [b]: patch[k] });
    } else this.data[k] = patch[k];
  });
  if (cb) cb();
};
const sent = (suffix, method) =>
  calls.some((c) => c.url.endsWith(suffix) && (!method || c.method === method));
const ok = (c, msg) => {
  console.log(`${c ? '  ✓' : '  ✗'} ${msg}`);
  return c;
};

(async () => {
  let pass = true;
  page.setData({ novelId: ID });
  page.enterId = ID;

  console.log('== 1) 已查出严重撞车时点「定版」→ 必须被拦下，不发起定版 ==');
  dupRisk = 'high';
  page.setData({ dupReport: dupReport() });
  calls.length = 0;
  page.finalize({ type: 'tap' }); // bindtap 会传 event，不能因此被当成"已确认"
  await sleep(60);
  pass = ok(!sent('/finalize'), '没有发起 /finalize（省掉几分钟白跑）') && pass;
  pass = ok(toasts.indexOf('严重撞车：先换书名或换题材') >= 0, '给出明确提示') && pass;

  console.log('\n== 2) 点「我已确认风险，仍要定版」→ 才带 acceptDup ==');
  finalizeBehavior = 'done';
  calls.length = 0;
  await page.forceFinalize();
  const fin = calls.find((c) => c.url.endsWith('/finalize'));
  pass = ok(!!fin, '发起了 /finalize') && pass;
  pass = ok(!!fin && fin.data && fin.data.acceptDup === true, '请求体带 acceptDup: true') && pass;

  console.log('\n== 3) 点选推荐书名的闭环：改名 → 按差异化重出大纲 → 重新查重 ==');
  dupRisk = 'low';
  calls.length = 0;
  await page.applyDupTitle({ currentTarget: { dataset: { t: '千禧年：我从地摊起家' } } });
  const iPut = calls.findIndex((c) => c.method === 'PUT' && c.url === `/novel/${ID}`);
  const iOut = calls.findIndex((c) => c.url.endsWith('/outline'));
  const iDup = calls.findIndex((c) => c.url.endsWith('/check-duplicate'));
  pass = ok(iPut >= 0 && calls[iPut].data.title === '千禧年：我从地摊起家', '先改书名') && pass;
  pass = ok(iOut > iPut, '改名后才重出大纲') && pass;
  pass = ok(iOut >= 0 && /避撞车/.test(String(calls[iOut].data.opinion)), '重出大纲时带上避撞车要求') && pass;
  pass = ok(iDup > iOut, '新名再查一次（闭环，防止换个名还是撞）') && pass;
  pass = ok(page.data.titleEdit === '千禧年：我从地摊起家', '页面书名已同步') && pass;

  console.log('\n== 4) 后端 DUP_HIGH 中断定版 → 不当普通失败，拉回报告给处置面板 ==');
  finalizeBehavior = 'dupHigh';
  dupRisk = 'high'; // 后端中断时落库的报告仍是 high
  page.setData({ dupReport: null, taskError: '' });
  calls.length = 0;
  navs.length = 0; // 清掉前几步产生的跳转记录，只断言本次
  await page.runFinalizeFlow(false);
  pass = ok(page.data.taskError === '', '不显示成"定版失败"这种没法操作的报错') && pass;
  pass = ok(!!page.data.dupReport && page.data.dupReport.risk === 'high', '撞车报告已拉回页面') && pass;
  pass = ok(!!page.data.dupReport && page.data.dupReport.titleSuggestions.length >= 3, `可选书名 ${page.data.dupReport.titleSuggestions.length} 个（≥3）`) && pass;
  pass = ok(toasts.indexOf('严重撞车，定版已中断') >= 0, '提示是"已中断"而非"失败"') && pass;
  pass = ok(!navs.some((u) => u.indexOf('/pages/intro/intro') >= 0), '没有跳去作品资料页（因为没定版成功）') && pass;

  console.log(`\n===== 结果：${pass ? '全部通过 ✓' : '存在失败 ✗'} =====`);
  process.exit(pass ? 0 : 1);
})();
