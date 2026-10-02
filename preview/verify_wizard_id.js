/**
 * 向导页「作品关联」桩测试。
 * 复现并防止回归：从首页点作品进入第④步时，this.data.novelId 必须被赋值，
 * 否则「立即查重 / 定版 / 重来」全部失效（前两个静默 return，看起来像按钮坏了）。
 *
 * 用法：node preview/verify_wizard_id.js
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../miniprogram');
const PAGE = path.join(ROOT, 'pages/wizard/wizard.js');
const NOVEL_ID = 'TESTNOVEL0001';

const log = [];
const store = {};
const calls = [];

// ---------- 桩：wx ----------
global.wx = {
  showLoading() {}, hideLoading() {},
  showToast(o) { log.push('toast: ' + o.title); },
  showModal() {}, setNavigationBarColor() {}, vibrateShort() {},
  setStorageSync(k, v) { store[k] = v; },
  getStorageSync(k) { return store[k]; },
  removeStorageSync(k) { delete store[k]; },
};
global.getApp = () => ({ globalData: { platform: 'fanqie', novelId: '' } });

// ---------- 桩：request（拦截所有网络） ----------
const reqPath = require.resolve(path.join(ROOT, 'utils/request.js'));
function fakeRequest(url, method = 'GET') {
  calls.push(`${method} ${url}`);
  if (method === 'GET' && url === `/novel/${NOVEL_ID}`) {
    return Promise.resolve({
      id: NOVEL_ID, title: '重生1998：从摆地摊到商业帝国', genre: '都市·重生',
      targetReader: '男频', contractStatus: 'signing', chapterWords: 2000,
      sellPoint: '重回98年', outline: '三幕大纲', platform: 'fanqie', bibleStatus: 'generating',
    });
  }
  return Promise.resolve({ risk: 'low', title: '新名字' });
}
require.cache[reqPath] = { id: reqPath, filename: reqPath, loaded: true, exports: { request: fakeRequest } };

// ---------- 桩：Page ----------
let cfg = null;
global.Page = (c) => { cfg = c; };
require(PAGE);

// ---------- 造页面实例 ----------
const page = Object.assign({}, cfg);
page.data = JSON.parse(JSON.stringify(cfg.data));
page.setData = function (patch, cb) {
  Object.keys(patch).forEach((k) => {
    if (k.indexOf('.') > 0) { // 只有 'a.b' 这种简单路径需要用
      const [a, b] = k.split('.');
      this.data[a] = Object.assign({}, this.data[a], { [b]: patch[k] });
    } else this.data[k] = patch[k];
  });
  if (cb) cb();
};

const ok = (c, msg) => console.log(`${c ? '  ✓' : '  ✗'} ${msg}`) || c;

(async () => {
  let pass = true;
  console.log('== 1) 从首页点作品进入（?id=...）→ onLoad ➜ resume ==');
  page.onLoad({ id: NOVEL_ID });
  await new Promise((r) => setTimeout(r, 120)); // resume 未被 await，等它跑完

  pass = ok(page.data.novelId === NOVEL_ID, `data.novelId = ${JSON.stringify(page.data.novelId)}（应为 ${NOVEL_ID}）`) && pass;
  pass = ok(page.data.step === 4, `data.step = ${page.data.step}`) && pass;
  pass = ok(!!(page.data.outline && page.data.outline.outline), '大纲已恢复') && pass;
  pass = ok(page.data.titleEdit === '重生1998：从摆地摊到商业帝国', '作品名已恢复') && pass;

  console.log('\n== 2) 点「🔍 立即查重」 ==');
  calls.length = 0;
  await page.checkDup();
  pass = ok(calls.some((c) => c === `POST /novel/${NOVEL_ID}/check-duplicate`), `发出请求：${calls.join(' | ') || '（无！就是 bug）'}`) && pass;
  pass = ok(log.indexOf('toast: 未发现明显撞车') >= 0, '查重结果已提示') && pass;

  console.log('\n== 3) 点「↻ 重来」 ==');
  calls.length = 0; log.length = 0;
  await page.regen();
  pass = ok(calls.some((c) => c === `POST /novel/${NOVEL_ID}/outline`), `发出请求：${calls.join(' | ') || '（无！就是 bug）'}`) && pass;
  pass = ok(log.indexOf('toast: 还没有作品，先选题材') < 0, '不再误报「还没有作品」') && pass;

  console.log('\n== 4) 点「保存」作品名 ==');
  page.setData({ titleEdit: '改名后的书名' });
  calls.length = 0; log.length = 0;
  await page.saveTitle();
  pass = ok(calls.some((c) => c === `PUT /novel/${NOVEL_ID}`), `发出请求：${calls.join(' | ') || '（无！就是 bug）'}`) && pass;

  console.log('\n== 5) 全局缓存丢失（页面被回收）时仍能靠 URL 参数兜底 ==');
  global.getApp = () => ({ globalData: { platform: 'fanqie', novelId: '' } }); // 清空全局
  page.data.novelId = '';
  pass = ok(page.curId() === NOVEL_ID, `curId() = ${page.curId()}（靠 enterId 兜底）`) && pass;

  console.log(`\n===== 结果：${pass ? '全部通过 ✓' : '存在失败 ✗'} =====`);
  process.exit(pass ? 0 : 1);
})();
