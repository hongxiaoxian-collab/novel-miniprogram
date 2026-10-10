/**
 * 封面「真图」合成器 —— 把 novel-cover-cn 技能那套流程搬到后端，做成小程序能自己出图的流水线。
 *
 * 【为什么必须这样分工】
 *   1) 底图交给生图模型，但**绝不让它写任何文字**：AI 画中文 99% 是乱码/鬼画符，
 *      而封面上的书名必须与后台作品名一字不差（平台判定"封面与内容不符"会驳回）。
 *   2) 书名/笔名/题材标签一律这里用字库精确叠加 —— 字形确定、可复核。
 *   3) 底图常带工具水印（右下角），底部压一条纯黑带盖掉，比修图干净。
 *   4) 所有文字必须描边：底图是照片级细节，不描边的字直接糊进背景。
 *
 * 【为什么用 @napi-rs/canvas 而不是 Pillow / sharp】
 *   服务端是 Windows ECS，跑的是 Node。@napi-rs/canvas 是预编译二进制（含 win32-x64），
 *   npm install 即用、不需要编译环境，且 GlobalFonts 能直接注册系统里的 msyhbd.ttc。
 *   sharp 的 SVG 叠字依赖 fontconfig 找中文字体，在 Windows 上经常找不到字、直接空白。
 *
 * 【排版口径与技能脚本 make_cover.py 一致】换实现不换观感，两处输出应当肉眼无差。
 */
import * as fs from 'fs';
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';

/** 字体候选：Windows 优先微软雅黑粗体，退化到黑体；Linux 走 Noto */
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
];
const FAMILY = 'CoverBold';

let fontPath = '';
function ensureFont(): string {
  if (fontPath) return fontPath;
  for (const p of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        // 注意：新版 API 是 GlobalFonts.registerFromPath，老文档里的 registerFont 已不存在
        GlobalFonts.registerFromPath(p, FAMILY);
        fontPath = p;
        return p;
      }
    } catch {
      /* 这个字体不可用，继续试下一个 */
    }
  }
  throw new Error(`未找到中文字体，尝试过：${FONT_CANDIDATES.join(' / ')}`);
}

export interface CoverTextOpts {
  title: string;
  /** 第二行书名（不给则自动拆行） */
  title2?: string | null;
  /** 不拆行 */
  noSplit?: boolean;
  author?: string;
  /** 副标题/题材标签，如「女频 · 古言 · 权谋宅斗」 */
  sub?: string;
  /** 书名主色 RGB */
  color?: [number, number, number];
  strokeColor?: [number, number, number];
  /** 书名首行 y（图高比例） */
  top?: number;
  /** 底部渐变起点 */
  maskTop?: number;
  /** 水印遮盖黑带起点 */
  bandTop?: number;
  size1?: number;
  size2?: number;
  sizeAuthor?: number;
  sizeSub?: number;
  noMask?: boolean;
  noBand?: boolean;
  /** 输出尺寸（默认按底图等比，指定 outW 时按 3:4 推高度） */
  outW?: number;
  outH?: number;
  /** JPEG 质量 */
  quality?: number;
}

export interface CoverResult {
  buf: Buffer;
  W: number;
  H: number;
  title1: string;
  title2: string | null;
  font: string;
}

/**
 * 书名拆两行。番茄/七猫书名常见 8-15 字，两行最稳。
 *
 * 断行优先级：**标点 > 词中切**。断在「：」「，」后永远比把「邮票」切成「邮 / 票」好看，
 * 所以只要标点两边各不少于 2 字，就认这个标点，不再比对长短是否均衡
 * （两行字号各自自适应，主标题大字 + 副标题小字本来就是平台封面最常见的版式）。
 * 曾经这里卡了「两边长度差 ≤4」，结果「高考前三天：我靠邮票IC卡造出中国芯」落回中点切分，
 * 把「邮票」劈成两半 —— 这是作者一眼就能看出来的低级瑕疵。
 */
export function splitTitle(
  title: string,
  noSplit?: boolean,
  title2?: string | null,
): [string, string | null] {
  const t = String(title || '').trim();
  if (title2) return [t, title2];
  if (noSplit) return [t, null];
  // 「：」最优先：书名的主副标题结构几乎都靠它
  for (const sep of ['：', ':', '，', ',', '！', '!', '·', ' ']) {
    const i = t.indexOf(sep);
    if (i <= 0) continue;
    const a = t.slice(0, i).trim();
    const b = t.slice(i + 1).trim();
    if (a.length < 2 || b.length < 2) continue;
    return [a, b];
  }
  const chars = [...t];
  if (chars.length <= 7) return [t, null];
  const mid = Math.floor(chars.length / 2);
  return [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
}

/**
 * 在 AI 底图上叠加书名/笔名/题材标签。
 * 输出恒为 JPEG（RGBA 的 PNG 在部分平台上传/审核会出问题）。
 */
export async function composeCover(base: Buffer, o: CoverTextOpts): Promise<CoverResult> {
  const font = ensureFont();
  const img = await loadImage(base);
  const W = o.outW || img.width;
  // 平台封面统一 3:4 竖版；底图若是 896x1200 这种 0.747 的偏差，一律拉正
  const H = o.outH || (o.outW ? Math.round((W * 4) / 3) : Math.round((img.height * W) / img.width));

  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img as any, 0, 0, W, H);

  // ① 底部渐变遮罩：压暗文字区，提升对比度
  if (!o.noMask) {
    const y0 = Math.floor(H * (o.maskTop ?? 0.56));
    for (let y = y0; y < H; y++) {
      const a = Math.min(1, Math.pow((y - y0) / (H - y0), 0.85));
      ctx.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
      ctx.fillRect(0, y, W, 1);
    }
  }
  // ② 最底部纯黑带：盖掉生图工具的水印
  if (!o.noBand) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, Math.floor(H * (o.bandTop ?? 0.855)), W, H * 0.2);
  }

  const stroke = o.strokeColor || [20, 12, 0];
  const GOLD = o.color || [245, 215, 138];
  const CREAM: [number, number, number] = [255, 236, 190];
  const fontOf = (px: number) => `${px}px "${FAMILY}"`;

  /** 按图宽比例取字号；超宽自动缩到不溢出（换张图也不会崩） */
  const fitFont = (text: string, ratio: number, maxW = 0.88) => {
    let size = Math.floor(W * ratio);
    while (size > 12) {
      ctx.font = fontOf(size);
      if (ctx.measureText(text).width <= W * maxW) return fontOf(size);
      size -= 2;
    }
    return fontOf(12);
  };

  /** 居中绘一行（先描边后填色），返回这行的墨迹高度，供下一行定位 */
  const line = (
    text: string,
    f: string,
    y: number,
    fill: [number, number, number],
    strokeW: number,
  ) => {
    ctx.font = f;
    const m = ctx.measureText(text);
    const h = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    if (strokeW > 0) {
      ctx.lineWidth = strokeW * 2; // canvas 的描边以路径为中心向两侧扩，故取 2 倍
      ctx.strokeStyle = `rgb(${stroke.join(',')})`;
      ctx.strokeText(text, W / 2, y);
    }
    ctx.fillStyle = `rgb(${fill.join(',')})`;
    ctx.fillText(text, W / 2, y);
    return h;
  };

  const [t1, t2] = splitTitle(o.title, o.noSplit, o.title2);
  const f1 = fitFont(t1, o.size1 ?? 0.118);
  const f3 = fontOf(Math.floor(W * (o.sizeSub ?? 0.04)));

  const y = Math.floor(H * (o.top ?? 0.615));
  const h1 = line(t1, f1, y, GOLD, 6);
  let ly: number;
  if (t2) {
    const y2 = y + Math.round(h1) + Math.floor(H * 0.02);
    const h2 = line(t2, fitFont(t2, o.size2 ?? 0.12), y2, CREAM, 7);
    ly = y2 + Math.round(h2) + Math.floor(H * 0.03);
  } else {
    ly = y + Math.round(h1) + Math.floor(H * 0.03);
  }

  // ③ 分隔细线
  ctx.strokeStyle = 'rgba(198,164,96,0.86)';
  ctx.lineWidth = Math.max(2, Math.round(W * 0.0025));
  ctx.beginPath();
  ctx.moveTo(W * 0.24, ly);
  ctx.lineTo(W * 0.76, ly);
  ctx.stroke();

  // ④ 笔名 → ⑤ 题材标签
  const ay = ly + Math.floor(H * 0.02);
  let ha = 0;
  if (o.author) {
    ha = line(`${o.author}  著`, fontOf(Math.floor(W * (o.sizeAuthor ?? 0.047))), ay, [243, 228, 190], 4);
  }
  if (o.sub) {
    line(o.sub, f3, ay + Math.round(ha) + Math.floor(H * 0.016), [228, 226, 218], 3);
  }

  const buf = cv.toBuffer('image/jpeg', o.quality ?? 92) as Buffer;
  return { buf, W, H, title1: t1, title2: t2, font };
}

/* ==================== 生图提示词 ==================== */

/** 作品元信息（从 Novel 行里挑出来的、拼提示词要用的字段） */
export interface CoverMeta {
  title: string;
  platform: string;
  platformName: string;
  genre: string;
  targetReader: string;
  sellPoint: string;
  outline: string;
  coreSetting: string;
  keyEvent: string;
  mainTag: string;
  characters: string;
}

/**
 * 第一步提示词：让文模型把「这部作品的情节」改写成一句**无字画面**的拍摄脚本。
 * 关键是把技能踩过的三个坑写进约束里：不许出现文字、下方留白、别画多人正面特写。
 */
export function scenePromptOf(m: CoverMeta): string {
  return `你是【${m.platformName}】平台的封面摄影指导。根据下面这部作品的情节，写一句**无字画面**的拍摄脚本。

作品名=《${m.title}》
题材=${m.genre || '（未定）'}｜目标读者=${m.targetReader || '（未定）'}｜一句话卖点=${m.sellPoint || '（未定）'}
大纲=${(m.outline || '').slice(0, 600)}
核心设定=${m.coreSetting || '（未定）'}
首卷锚定事件=${m.keyEvent || '（未定）'}
主要人物=${m.characters || '（未定）'}

【硬性要求】
1. scene 只描述画面本身：人物（可只给局部 / 侧脸 / 背影）、动作、手里拿的东西、所在场景、光源方向、氛围、主色调。
2. **画面中绝对不能出现任何文字**——不写书名、不写招牌字、不写字条内容。中文由后期精确叠加，模型写字必是乱码。
3. 构图必须**上方三分之二是主体、下方三分之一留深色干净的空白**（这块空白后期要压书名）。
4. 一到两个人、动作明确，**不要多人正面特写**（AI 画正脸极易崩）。
5. 电影级写实摄影质感、高细节、深色调。

【输出格式】只输出一个 JSON，不要任何解释、不要 Markdown 代码块：
{"scene":"一句中文画面描述，80-150 字","mood":"氛围词 2-3 个"}
禁止出现英文、禁止提到 Midjourney / Stable Diffusion / 提示词 / 参数；scene 里不要出现书名。`;
}

/** 模型爱跑偏：输出英文、写 Markdown、去解释"我给你写好了提示词"。这里把噪音全部清掉 */
const SCENE_NOISE = /(midjourney|stable\s*diffusion|prompt|提示词|参数|seed|--ar|mj\b|dall|绘图工具)/i;

/**
 * 从模型回复里抠出真正的画面描述。
 * 真实踩坑：它会先讲一段"我已经为你整理好了…"，再给英文提示词。
 * 这里的策略是**取最长的一段连续中文**，命中噪音词就整段丢弃（宁可退回模板句）。
 */
export function cleanScene(raw: string): string {
  const s = String(raw || '')
    .replace(/[*#`>_|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const runs = s.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5，。、；：？！“”‘’（）—…·0-9a-zA-Z ]{10,}/g) || [];
  const best = (runs.sort((a, b) => b.length - a.length)[0] || '').trim();
  if (!best || SCENE_NOISE.test(best)) return '';
  return best.slice(0, 200);
}

/** 模型答非所问时的兜底画面：直接用作品自己的字段拼一句，保证永远有图可出 */
export function fallbackScene(m: CoverMeta): string {
  const first = String(m.characters || '').split('、').filter(Boolean)[0] || '';
  const who = first.replace(/[（(].*?[)）]/g, '').trim() || '主角';
  const where = String(m.keyEvent || m.coreSetting || `${m.genre || ''}故事发生的地方`).slice(0, 60);
  const warm = m.targetReader === '女频' || m.targetReader === '女生';
  return `${who}身处${where}，神情克制，一只手握着与剧情相关的关键物件，`
    + (warm
      ? '柔光从侧面打亮侧脸与手部，氛围通透而有情绪'
      : '暖黄侧光从右上方打亮主体，冷硬厚重、有金属质感')
    + '，背景虚化';
}

/**
 * 第二步：把画面脚本套进技能固化的 prompt 骨架 —— 最后那句
 * 「不要任何文字 + 下方留深色空白」是整条流水线的命根子，一个字都不能省。
 */
export function wrapCoverPrompt(scene: string, m: CoverMeta): string {
  const body = String(scene || '')
    .replace(/\s+/g, '')
    .replace(/[《》""'']/g, '')
    .slice(0, 220);
  return (
    `竖版小说封面，${m.genre || '小说'}，${m.targetReader || ''}，` +
    `${body}，` +
    `构图：主体占上方三分之二，下方三分之一为深色的干净空白区，用于后期排版，` +
    `不要出现任何文字、字母、数字、logo、水印，不要出现扭曲的字体，不要多人正面特写。`
  );
}

/** 副标题（题材标签）：平台扫榜读者要在 0.5 秒内判断"这是什么书" */
export function coverSubtitle(m: CoverMeta): string {
  const parts = [m.targetReader, m.mainTag, m.genre].map((s) => String(s || '').trim()).filter(Boolean);
  // 去重（目标读者常与题材重叠，如"女频 · 古言 · 古言"）
  const uniq: string[] = [];
  for (const p of parts) if (!uniq.includes(p)) uniq.push(p);
  return uniq.slice(0, 3).join(' · ');
}
