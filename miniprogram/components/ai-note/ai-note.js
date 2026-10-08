/**
 * AI 生成内容标识条。
 * 用法：<ai-note />（默认文案）或 <ai-note text="..." compact="{{true}}" />
 */
Component({
  properties: {
    text: { type: String, value: '' },       // 自定义说明；空则用默认合规文案
    compact: { type: Boolean, value: false }, // 紧凑模式（嵌在卡片内时用）
  },
});
