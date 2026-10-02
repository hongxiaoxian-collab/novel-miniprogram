/**
 * 全局作者信息：笔名 + 作者简介。
 *
 * 为什么做成全局：番茄 / 七猫都强制要求封面带「书名 + 笔名」，作家页还要作者简介。
 * 所以只确认一次，之后新建作品、生成封面、上架资料全部自动带入。
 */
const PEN_KEY = 'penName';
const INTRO_KEY = 'authorIntro';

const read = (k) => {
  try {
    return wx.getStorageSync(k) || '';
  } catch (e) {
    return '';
  }
};

const write = (k, v) => {
  try {
    wx.setStorageSync(k, v);
  } catch (e) { /* 存储失败不影响本次会话 */ }
  const app = getApp();
  if (app && app.globalData) {
    if (k === PEN_KEY) app.globalData.penName = v;
    else app.globalData.authorIntro = v;
  }
  return v;
};

// ---------- 笔名 ----------
/** 读取已确认的笔名（空串代表还没设过） */
const getPen = () => read(PEN_KEY);

/** 写入全局笔名 */
const setPen = (name) => write(PEN_KEY, String(name || '').trim().slice(0, 16));

/** 保证有笔名：没有就弹输入框让用户确认，确认后写入全局 */
function ensurePen() {
  return new Promise((resolve) => {
    const cur = getPen();
    if (cur) { resolve(cur); return; }
    wx.showModal({
      title: '确认你的笔名',
      content: '番茄和七猫都要求封面必须出现「书名 + 笔名」，先定一个笔名，后面所有作品和封面上会自动带上。',
      editable: true,
      placeholderText: '例如：青山不改',
      confirmText: '确认',
      success: (r) => {
        const v = (r.content || '').trim();
        if (!r.confirm || !v) { resolve(''); return; }
        resolve(setPen(v));
      },
      fail: () => resolve(''),
    });
  });
}

// ---------- 作者简介 ----------
const getIntro = () => read(INTRO_KEY);
const setIntro = (text) => write(INTRO_KEY, String(text || '').trim().slice(0, 300));

module.exports = { getPen, setPen, ensurePen, getIntro, setIntro };
