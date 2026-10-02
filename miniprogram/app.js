App({
  globalData: {
    // 测试服后端地址（部署后改这里；微信开发者工具里需在本小程序「开发设置」勾选不校验合法域名）
    baseUrl: 'http://120.79.174.44:3001',
    platform: 'fanqie', // fanqie | qimao
    novelId: '',        // 当前作品
    chapterId: '',      // 当前章节
    penName: '',        // 全局笔名（两平台封面硬性要求，只确认一次）
    authorIntro: '',    // 全局作者简介（作家页/上架资料用，只确认一次）
  },
  onLaunch() {
    try {
      this.globalData.platform = wx.getStorageSync('platform') || 'fanqie';
      this.globalData.penName = wx.getStorageSync('penName') || '';
      this.globalData.authorIntro = wx.getStorageSync('authorIntro') || '';
    } catch (e) { /* 首次启动无缓存 */ }
  },
});
