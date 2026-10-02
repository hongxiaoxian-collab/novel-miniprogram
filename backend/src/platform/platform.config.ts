/**
 * 平台元数据（标签词库）。
 *
 * 【规则来源】番茄官方问卷《番茄小说原创签约作品【分类标签】修改需求》明确：
 *   1. 阅读标签、内容标签都必须从「番茄作家助手 APP → 新建作品 → 阅读标签/内容标签」
 *      页面里选，**不能自己拟定不存在的标签**。
 *   2. 阅读标签：主题分类下**只能选 1 个**，整套最多 6 个。
 *   3. 内容标签：情节、人设维度**最多 4 个**，情感维度最多 2 个，**世界观维度最多 1 个**。
 *   4. 主分类为必选项且**仅能选 1 个**（官方《作品标签最全讲解》）。
 *
 * 【候选值来源】主分类取自番茄书城公开分类体系（男频 19 类 / 女频 18 类），
 * 其余取自平台公开榜单与官方文章中的真实标签词。AI 生成资料时被强制
 * 「只能从候选集里原样挑选」，避免编造平台不存在的标签导致审核被改。
 */

export interface PlatformMeta {
  key: 'fanqie' | 'qimao';
  name: string;
  readerOptions: string[];
  /** 阅读标签：主分类（按目标读者分池，必选 1 个）+ 主题 / 角色 / 情节 */
  readingTags: {
    main: Record<string, string[]>;
    theme: string[];
    role: string[];
    plot: string[];
  };
  /** 内容标签：情节 / 情感 / 人设 / 世界观 四个维度 */
  contentTags: {
    plot: string[];
    emotion: string[];
    persona: string[];
    world: string[];
  };
  signRuleHint: string;
}

const FANQIE_MAIN_MALE = [
  '传统玄幻', '玄幻脑洞', '东方仙侠', '西方奇幻', '都市日常', '都市修真', '都市高武',
  '都市种田', '都市脑洞', '战神赘婿', '历史古代', '历史脑洞', '悬疑脑洞', '悬疑灵异',
  '抗战谍战', '游戏体育', '科幻末世', '动漫衍生', '男频衍生',
];
const FANQIE_MAIN_FEMALE = [
  '古风世情', '宫斗宅斗', '古言脑洞', '玄幻言情', '种田', '年代', '豪门总裁', '职场婚恋',
  '青春甜宠', '现言脑洞', '快穿', '民国言情', '星光璀璨', '女频悬疑', '女频衍生',
  '科幻末世', '游戏体育', '悬疑脑洞',
];

export const PLATFORMS: PlatformMeta[] = [
  {
    key: 'fanqie',
    name: '番茄',
    readerOptions: ['男频', '女频'],
    readingTags: {
      main: { 男频: FANQIE_MAIN_MALE, 女频: FANQIE_MAIN_FEMALE },
      theme: [
        '穿越', '重生', '系统', '无敌', '苟道', '长生', '诸天万界', '末世求生', '年代', '星际',
        '网游', '美食', '医术', '鉴宝', '商战', '神豪', '马甲', '战神', '赘婿', '萌宝',
        '带球跑', '双强', '斗智斗勇', '无限流', '直播',
      ],
      role: [
        '强男主', '女强', '团宠', '废柴', '大佬', '天才', '腹黑', '病娇', '高冷', '逗比',
        '杀伐果断', '双男主', '群像',
      ],
      plot: [
        '装逼打脸', '逆袭', '升级', '复仇', '争霸', '种田', '夺宝', '探秘', '日常经营',
        '慢热', '轻松', '热血', '爽文',
      ],
    },
    contentTags: {
      plot: ['打脸', '升级', '争霸', '种田', '逆袭', '复仇', '夺宝', '探秘', '日常', '经营'],
      emotion: ['无CP', '单女主', '多女主', '甜宠', '虐恋', '群像'],
      persona: ['苟', '腹黑', '杀伐果断', '天才', '逗比', '高冷', '病娇', '大佬', '废柴'],
      world: ['现代', '架空', '古代', '末世', '星际', '异世界', '民国', '未来', '洪荒'],
    },
    signRuleHint: '签约小说需满 2w 字（以平台最新规则为准）',
  },
  {
    key: 'qimao',
    name: '七猫',
    readerOptions: ['男生', '女生'],
    readingTags: {
      main: {
        男生: ['都市', '玄幻', '悬疑', '历史', '科幻', '重生', '机械', '赘婿', '战神', '神豪'], // 【待核对】
        女生: ['现言', '古言', '悬疑', '科幻', '青春', '年代', '种田', '豪门'], // 【待核对】
      },
      theme: ['逆袭', '爽文', '系统', '兵王', '神医', '总裁', '甜宠'], // 【待核对】
      role: ['男强', '女强', '团宠', '废柴'], // 【待核对】
      plot: ['热血', '轻松', '虐恋', '复仇', '升级', '种田'], // 【待核对】
    },
    contentTags: {
      plot: ['装逼打脸', '升级', '种田', '逆袭'], // 【待核对】
      emotion: ['无CP', '甜宠', '虐恋'], // 【待核对】
      persona: ['腹黑', '逗比', '高冷'], // 【待核对】
      world: ['现代', '架空', '末世'], // 【待核对】
    },
    signRuleHint: '签约小说需满 2w 字（以平台最新规则为准）',
  },
];

/** 按 key（fanqie/qimao）查平台；同时容忍中文名（番茄/七猫），避免前端直传中文时 500 */
export function getPlatform(key: string): PlatformMeta {
  const p = PLATFORMS.find((x) => x.key === key || x.name === key);
  if (!p) throw new Error('未知平台：' + key);
  return p;
}

/** 取该作品目标读者对应的主分类候选（未指定时合并两池） */
export function mainCategoriesFor(p: PlatformMeta, reader?: string): string[] {
  const pool = p.readingTags.main;
  const hit = Object.keys(pool).find((k) => k === reader);
  return hit ? pool[hit] : Object.keys(pool).reduce((acc, k) => acc.concat(pool[k]), [] as string[]);
}

/** 把标签词库渲染成给 AI 看的「白名单」文本 */
export function tagWhitelist(p: PlatformMeta, reader?: string): string {
  const t = p.readingTags, c = p.contentTags;
  return [
    `主分类（必选 1 个）：${mainCategoriesFor(p, reader).join(' / ')}`,
    `主题（选 1 个）：${t.theme.join(' / ')}`,
    `角色（选 1 个）：${t.role.join(' / ')}`,
    `情节（选 1 个）：${t.plot.join(' / ')}`,
    `内容·情节（选 1 个）：${c.plot.join(' / ')}`,
    `内容·情感（选 1 个）：${c.emotion.join(' / ')}`,
    `内容·人设（选 1 个）：${c.persona.join(' / ')}`,
    `内容·世界观（选 1 个）：${c.world.join(' / ')}`,
  ].join('\n');
}
