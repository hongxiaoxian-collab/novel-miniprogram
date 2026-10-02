function copy(text, tip = '已复制') {
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: tip, icon: 'none' }),
  });
}
module.exports = { copy };
