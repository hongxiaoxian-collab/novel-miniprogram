const { request } = require('../../utils/request');
const { loadMe, loginNow } = require('../../utils/account');

/**
 * iOS 端虚拟支付要求微信 ≥ 8.0.68（底层走 Apple IAP）。
 * 版本不够时拉起支付必然失败，还不如提前说清楚让人去更新。
 */
function iosPayOk(version) {
  const cur = String(version || '').split('.').map(Number);
  const base = [8, 0, 68];
  for (let i = 0; i < 3; i++) {
    if ((cur[i] || 0) > base[i]) return true;
    if ((cur[i] || 0) < base[i]) return false;
  }
  return true;
}

Page({
  data: {
    loading: true,
    acct: null,
    pay: null,      // 可购买商品 + 支付有没有配好
    buying: false,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      const acct = await loadMe();
      this.setData({ loading: false, acct });
    } catch (e) {
      this.setData({ loading: false });
    }
    // 支付配置单独拉：它没配好也不该影响账号信息显示
    try {
      this.setData({ pay: await request('/pay/goods') });
    } catch (e) { /* 忽略 */ }
  },

  async onLogin() {
    const r = await loginNow();
    if (!r.ok) {
      wx.showToast({ title: r.msg || '登录失败', icon: 'none', duration: 2500 });
      return;
    }
    await this.load();
    wx.showToast({
      title: r.claimed ? `已登录，归拢了 ${r.claimed} 本作品` : '已登录',
      icon: 'none', duration: 2500,
    });
  },

  /**
   * 购买会员。走微信「虚拟支付」—— 会员是虚拟商品，用普通微信支付收这个钱是违规的
   * （微信 2026-04-01 起强制：虚拟商品必须走官方虚拟支付接口）。
   */
  async buy(e) {
    const planCode = (e && e.currentTarget && e.currentTarget.dataset.plan) || 'vip';
    if (this.data.buying) return;
    if (!this.data.acct || !this.data.acct.loggedIn) {
      wx.showToast({ title: '请先登录再购买', icon: 'none' });
      return;
    }
    if (!this.data.pay || !this.data.pay.enabled) {
      wx.showModal({
        title: '会员暂未开放',
        content: (this.data.pay && this.data.pay.missing && this.data.pay.missing.length)
          ? `还差这些配置：${this.data.pay.missing.join('、')}`
          : '支付功能正在开通中，请稍后再来。',
        showCancel: false,
      });
      return;
    }

    // iOS 端对微信版本有硬要求，不满足直接提示，别让人付了款才发现付不了
    let sys = {};
    try { sys = wx.getSystemInfoSync() || {}; } catch (err) { sys = {}; }
    if (sys.platform === 'ios' && !iosPayOk(sys.version)) {
      wx.showModal({
        title: '请更新微信',
        content: 'iOS 端购买会员需要微信 8.0.68 及以上版本，请更新后再试。',
        showCancel: false,
      });
      return;
    }

    this.setData({ buying: true });
    wx.showLoading({ title: '下单中…' });
    let outTradeNo = '';
    try {
      const payData = await request('/pay/order', 'POST', { planCode });
      outTradeNo = payData.outTradeNo;
      wx.hideLoading();

      // 拉起支付。这里的 success 只能说明"用户在微信里付了"，不能作为发货依据
      // （用户付完直接退出小程序，这个回调就丢了）—— 真正的到账以后端查单为准。
      await new Promise((resolve, reject) => {
        wx.requestVirtualPayment({
          mode: payData.mode,
          signData: payData.signData,
          paySig: payData.paySig,
          signature: payData.signature,
          success: resolve,
          fail: reject,
        });
      });

      wx.showLoading({ title: '确认到账…' });
      const ok = await this.waitPaid(outTradeNo);
      wx.hideLoading();
      this.setData({ buying: false });
      if (ok) {
        wx.showToast({ title: '会员已开通', icon: 'success', duration: 2500 });
        await this.load();
      } else {
        wx.showModal({
          title: '还没查到到账',
          content: '支付可能还在处理中。稍等半分钟后回到本页刷新即可；若一直没到账，请联系作者并提供订单号。',
          showCancel: false,
        });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ buying: false });
      const msg = (err && (err.errMsg || err.message)) || '';
      // 用户自己取消不算错误，不打扰
      if (/cancel/i.test(msg)) return;
      wx.showToast({ title: msg || '支付失败，请重试', icon: 'none', duration: 2500 });
    }
  },

  /** 轮询订单状态。微信的发货推送偶尔会晚几秒，前端多问几次最省事 */
  async waitPaid(outTradeNo) {
    for (let i = 0; i < 10; i++) {
      try {
        const r = await request(`/pay/order/${outTradeNo}`);
        if (r && r.status === 'paid') return true;
      } catch (e) { /* 继续重试 */ }
      await new Promise((s) => setTimeout(s, 2000));
    }
    return false;
  },

  /** 打开微信官方隐私指引（内容来自后台配置的《用户隐私保护指引》） */
  openPrivacy() {
    if (!wx.openPrivacyContract) {
      wx.showToast({ title: '当前版本不支持', icon: 'none' });
      return;
    }
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '后台尚未配置隐私指引', icon: 'none' }),
    });
  },

  /** 注销：删掉账号和名下全部作品，不可恢复，必须二次确认 */
  destroy() {
    const that = this;
    wx.showModal({
      title: '注销账号',
      content: '将永久删除你的全部作品、章节和体检记录，且无法恢复。建议先导出作品再注销。确定继续吗？',
      confirmText: '确认注销',
      confirmColor: '#e64340',
      success(res) {
        if (!res.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '这是最后一次确认，点击确认后数据立即删除。',
          confirmText: '我已备份，删除',
          confirmColor: '#e64340',
          success(r2) {
            if (!r2.confirm) return;
            request('/auth/me', 'DELETE', {})
              .then((ret) => {
                wx.removeStorageSync('token');
                const app = getApp();
                app.globalData.token = '';
                app.globalData.me = null;
                app.globalData.loggedIn = false;
                wx.showToast({ title: `已注销，删除 ${ret.deletedNovels} 部作品`, icon: 'none', duration: 2500 });
                setTimeout(() => wx.reLaunch({ url: '/pages/works/works' }), 1500);
              })
              .catch(() => wx.showToast({ title: '注销失败，请重试', icon: 'none' }));
          },
        });
      },
    });
  },

  goBack() { wx.navigateBack(); },
});
