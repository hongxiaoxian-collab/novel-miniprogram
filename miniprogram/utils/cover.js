/**
 * 封面「按情节生成」的绘制零件库。
 *
 * 思路：AI 只负责出「封面方案」（场景 / 配色 / 构图 / 人物 / 道具），
 * 具体像素由这里按方案实时画出来。好处：
 *  1) 每部作品的封面真的来自它自己的情节，而不是从固定几款模板里挑；
 *  2) 全程 canvas 绘制，书名笔名一定是可读文字（AI 生图最容易把中文写成乱码）；
 *  3) 输出仍是平台要求的 600×800，不需任何外部图片接口。
 */
const VW = 600;
const VH = 800;

/** AI 可选的"道具"词表：键是代码用的英文，值是给 AI 看的中文（也是页面上的说明） */
const PROPS = {
  books: '旧书 / 连环画堆',
  sign: '手写招牌 / 价目牌',
  bike: '二八自行车',
  crate: '木箱 / 货箱',
  truck: '卡车 / 货车',
  pc: '电脑 / 显示器',
  coin: '钱币 / 钞票',
  sword: '刀剑 / 兵器',
  lantern: '灯笼',
  chart: '股市曲线 / 折线图',
  crane: '塔吊 / 工地',
  skyline: '城市楼群',
  mountain: '远山',
  ring: '星环 / 轨道',
  factory: '厂房 / 烟囱',
};

/** 场景类型：决定远景怎么画 */
const SCENERY = { city: '城市街景', county: '县城老街', mountain: '山野', space: '星空', indoor: '室内', factory: '工业区' };

const LAYOUTS = ['center', 'band', 'side'];
const FIG_TYPES = ['modern', 'ancient', 'sci'];
const GENDERS = ['male', 'female'];
const HAIRS = ['short', 'long', 'bun'];
const OUTFITS = ['worker', 'suit', 'coat', 'dress', 'armor', 'robe'];
const POSES = ['hold', 'walk', 'look'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = (v, list, fb) => (list.indexOf(v) >= 0 ? v : fb);
const num = (v, fb, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
};

/**
 * 校验并补全 AI 给的方案：颜色必须是合法 #rrggbb、枚举必须在词表内、
 * 比例必须落在合理区间 —— 模型偶尔会给出 `red` 或 `0.99` 这类值，直接画会全黑/人物跑出画面。
 */
function normalizePlan(raw, fb) {
  const base = fb || {};
  const p = raw || {};
  const pal = p.palette || {};
  const bpal = base.palette || {};
  const color = (v, d) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : d);
  const props = (Array.isArray(p.props) ? p.props : []).filter((k) => PROPS[k]).slice(0, 4);
  const fig = p.figure || {};
  const bfig = base.figure || {};
  return {
    v: 2,
    sceneType: pick(p.sceneType, Object.keys(SCENERY), base.sceneType || 'city'),
    layout: pick(p.layout, LAYOUTS, base.layout || 'center'),
    props: props.length ? props : (base.props || []),
    figure: {
      type: pick(fig.type, FIG_TYPES, bfig.type || 'modern'),
      gender: pick(fig.gender, GENDERS, bfig.gender || 'male'),
      hair: pick(fig.hair, HAIRS, bfig.hair || 'short'),
      outfit: pick(fig.outfit, OUTFITS, bfig.outfit || 'worker'),
      pose: pick(fig.pose, POSES, bfig.pose || 'hold'),
    },
    palette: {
      bg: [
        color((pal.bg || [])[0], (bpal.bg || [])[0] || '#1b2233'),
        color((pal.bg || [])[1], (bpal.bg || [])[1] || '#41506b'),
      ],
      accent: color(pal.accent, bpal.accent || '#ffd77a'),
      cloth: color(pal.cloth, bpal.cloth || '#1a2130'),
      inner: color(pal.inner, bpal.inner || '#e8edf5'),
      skin: color(pal.skin, bpal.skin || '#eccfae'),
      hair: color(pal.hair, bpal.hair || '#14161d'),
    },
    horizon: num(p.horizon, base.horizon || 0.68, 0.5, 0.78),
    heroScale: num(p.heroScale, base.heroScale || 0.95, 0.7, 1.15),
    scene: String(p.scene || base.scene || '').slice(0, 120),
    mood: String(p.mood || base.mood || '').slice(0, 30),
  };
}

function rgba(hex, a) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** 远景：按场景类型画一层剪影（深度靠透明度拉开） */
function drawScenery(ctx, plan) {
  const t = plan.sceneType;
  ctx.save();
  if (t === 'space') {
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    for (let i = 0; i < 60; i++) {
      const x = (((i * 97) % 100) / 100) * VW;
      const y = (((i * 61) % 52) / 100) * VH * 0.7;
      ctx.beginPath(); ctx.arc(x, y, i % 4 ? 1.4 : 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = rgba(plan.palette.accent, 0.5);
    ctx.lineWidth = 3;
    [0.3, 0.22].forEach((r) => {
      ctx.beginPath(); ctx.arc(VW * 0.76, VH * 0.19, VW * r, 0, Math.PI * 2); ctx.stroke();
    });
  } else if (t === 'mountain') {
    for (let i = 0; i < 3; i++) {
      const y = VH * (0.4 + i * 0.12);
      const k = 1 - i * 0.16;
      ctx.fillStyle = rgba('#080a10', 0.26 + i * 0.2);
      ctx.beginPath();
      ctx.moveTo(-60, VH);
      ctx.lineTo(-60, y + 110);
      ctx.quadraticCurveTo(VW * 0.3, y - 90 * k, VW * 0.62, y + 70);
      ctx.quadraticCurveTo(VW * 0.88, y + 140, VW + 60, y + 40);
      ctx.lineTo(VW + 60, VH);
      ctx.closePath(); ctx.fill();
    }
  } else if (t === 'county' || t === 'indoor') {
    // 低矮老房 + 电线杆，县城年代感的骨架
    const hs = [0.3, 0.44, 0.26, 0.5, 0.36, 0.42];
    const bw = VW / hs.length;
    hs.forEach((f, i) => {
      const bh = VH * 0.3 * f;
      ctx.fillStyle = rgba('#080b12', 0.3 + (i % 3) * 0.08);
      ctx.fillRect(i * bw + 4, VH * plan.horizon - bh, bw * 0.86, bh + VH * 0.4);
    });
    ctx.strokeStyle = rgba('#05070c', 0.5);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(VW * 0.16, VH * plan.horizon); ctx.lineTo(VW * 0.16, VH * 0.34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(VW * 0.09, VH * 0.37); ctx.lineTo(VW * 0.23, VH * 0.37); ctx.stroke();
  } else if (t === 'factory') {
    for (let i = 0; i < 3; i++) {
      const x = VW * (0.12 + i * 0.3);
      ctx.fillStyle = rgba('#080b12', 0.34);
      ctx.fillRect(x, VH * 0.3, 96, VH * plan.horizon - VH * 0.3 + 40);
      ctx.fillRect(x + 14, VH * 0.22, 22, VH * 0.1);
    }
  } else {
    // city：高低错落的楼群剪影
    const bs = [0.46, 0.68, 0.36, 0.82, 0.58, 0.3, 0.74, 0.5];
    const bw = VW / bs.length;
    bs.forEach((f, i) => {
      const bh = VH * 0.26 * f;
      ctx.fillStyle = rgba('#06080e', 0.24 + (i % 3) * 0.07);
      ctx.fillRect(i * bw, VH * plan.horizon - bh, bw * 0.86, bh + VH * 0.4);
    });
  }
  ctx.restore();
}

/** 道具：每个道具都按 (x, 地面 y, 缩放) 画，方便按方案排列 */
const DRAW = {
  books(ctx, x, gy, s, pal) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? rgba(pal.inner, 0.9) : rgba(pal.accent, 0.85);
      ctx.fillRect(x - 34 * s, gy - (i + 1) * 11 * s, 68 * s, 9 * s);
    }
  },
  sign(ctx, x, gy, s, pal) {
    ctx.fillStyle = rgba('#2b2418', 0.9);
    ctx.fillRect(x - 4 * s, gy - 92 * s, 8 * s, 92 * s);
    ctx.fillStyle = rgba(pal.accent, 0.92);
    ctx.fillRect(x - 40 * s, gy - 122 * s, 80 * s, 34 * s);
    ctx.fillStyle = rgba('#22190c', 0.85);
    ctx.fillRect(x - 30 * s, gy - 113 * s, 52 * s, 5 * s);
    ctx.fillRect(x - 30 * s, gy - 102 * s, 36 * s, 5 * s);
  },
  bike(ctx, x, gy, s, pal) {
    ctx.strokeStyle = rgba('#0d0f14', 0.85);
    ctx.lineWidth = 5 * s;
    ctx.beginPath(); ctx.arc(x - 30 * s, gy - 26 * s, 24 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 30 * s, gy - 26 * s, 24 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 30 * s, gy - 26 * s); ctx.lineTo(x, gy - 62 * s); ctx.lineTo(x + 30 * s, gy - 26 * s);
    ctx.moveTo(x, gy - 62 * s); ctx.lineTo(x - 8 * s, gy - 26 * s);
    ctx.stroke();
    ctx.strokeStyle = rgba(pal.accent, 0.8);
    ctx.beginPath(); ctx.moveTo(x + 30 * s, gy - 62 * s); ctx.lineTo(x + 40 * s, gy - 76 * s); ctx.stroke();
  },
  crate(ctx, x, gy, s, pal) {
    ctx.fillStyle = rgba('#3a2a18', 0.92);
    ctx.fillRect(x - 36 * s, gy - 58 * s, 72 * s, 58 * s);
    ctx.strokeStyle = rgba(pal.accent, 0.6);
    ctx.lineWidth = 3 * s;
    ctx.strokeRect(x - 36 * s, gy - 58 * s, 72 * s, 58 * s);
    ctx.beginPath(); ctx.moveTo(x - 36 * s, gy - 58 * s); ctx.lineTo(x + 36 * s, gy); ctx.stroke();
  },
  truck(ctx, x, gy, s, pal) {
    ctx.fillStyle = rgba('#1d232e', 0.95);
    ctx.fillRect(x - 78 * s, gy - 60 * s, 116 * s, 42 * s);
    ctx.fillRect(x + 38 * s, gy - 46 * s, 44 * s, 28 * s);
    ctx.fillStyle = rgba(pal.inner, 0.75);
    ctx.fillRect(x + 46 * s, gy - 42 * s, 26 * s, 16 * s);
    ctx.fillStyle = rgba('#0a0c10', 0.95);
    ctx.beginPath(); ctx.arc(x - 48 * s, gy, 15 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 52 * s, gy, 15 * s, 0, Math.PI * 2); ctx.fill();
  },
  pc(ctx, x, gy, s, pal) {
    ctx.fillStyle = rgba('#20262f', 0.95);
    ctx.fillRect(x - 46 * s, gy - 82 * s, 92 * s, 62 * s);
    ctx.fillStyle = rgba(pal.accent, 0.55);
    ctx.fillRect(x - 38 * s, gy - 74 * s, 76 * s, 46 * s);
    ctx.fillStyle = rgba('#20262f', 0.95);
    ctx.fillRect(x - 10 * s, gy - 20 * s, 20 * s, 12 * s);
    ctx.fillRect(x - 34 * s, gy - 10 * s, 68 * s, 8 * s);
  },
  coin(ctx, x, gy, s, pal) {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = rgba(pal.accent, 0.9 - i * 0.15);
      ctx.beginPath();
      ctx.arc(x - 20 * s + i * 20 * s, gy - 14 * s - i * 8 * s, 17 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  sword(ctx, x, gy, s, pal) {
    ctx.strokeStyle = rgba(pal.inner, 0.92);
    ctx.lineWidth = 7 * s;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - 128 * s); ctx.stroke();
    ctx.strokeStyle = rgba(pal.accent, 0.95);
    ctx.lineWidth = 8 * s;
    ctx.beginPath(); ctx.moveTo(x - 22 * s, gy - 22 * s); ctx.lineTo(x + 22 * s, gy - 22 * s); ctx.stroke();
  },
  lantern(ctx, x, gy, s, pal) {
    ctx.strokeStyle = rgba('#241a10', 0.8);
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(x, gy - 170 * s); ctx.lineTo(x, gy - 126 * s); ctx.stroke();
    ctx.fillStyle = rgba(pal.accent, 0.92);
    ctx.beginPath();
    ctx.moveTo(x, gy - 126 * s);
    ctx.quadraticCurveTo(x + 44 * s, gy - 96 * s, x, gy - 62 * s);
    ctx.quadraticCurveTo(x - 44 * s, gy - 96 * s, x, gy - 126 * s);
    ctx.fill();
  },
  chart(ctx, x, gy, s, pal) {
    ctx.strokeStyle = rgba(pal.accent, 0.9);
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(x - 60 * s, gy - 20 * s);
    ctx.lineTo(x - 30 * s, gy - 48 * s);
    ctx.lineTo(x - 6 * s, gy - 34 * s);
    ctx.lineTo(x + 22 * s, gy - 78 * s);
    ctx.lineTo(x + 60 * s, gy - 104 * s);
    ctx.stroke();
    ctx.strokeStyle = rgba(pal.inner, 0.4);
    ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x - 60 * s, gy); ctx.lineTo(x + 60 * s, gy); ctx.stroke();
  },
  crane(ctx, x, gy, s, pal) {
    ctx.strokeStyle = rgba(pal.accent, 0.85);
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(x - 40 * s, gy); ctx.lineTo(x - 40 * s, gy - 190 * s);
    ctx.lineTo(x + 70 * s, gy - 190 * s);
    ctx.moveTo(x - 40 * s, gy - 150 * s); ctx.lineTo(x + 26 * s, gy - 190 * s);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 52 * s, gy - 190 * s); ctx.lineTo(x + 52 * s, gy - 120 * s); ctx.stroke();
  },
  skyline(ctx, x, gy, s, pal) {
    const hs = [0.5, 0.8, 0.36, 0.66, 0.44];
    hs.forEach((f, i) => {
      const h = 120 * s * f;
      ctx.fillStyle = rgba('#0a0d14', 0.8);
      ctx.fillRect(x - 70 * s + i * 30 * s, gy - h, 26 * s, h);
      ctx.fillStyle = rgba(pal.accent, 0.55);
      ctx.fillRect(x - 66 * s + i * 30 * s, gy - h + 8 * s, 18 * s, 4 * s);
    });
  },
  mountain(ctx, x, gy, s, pal) {
    ctx.fillStyle = rgba('#0b0f16', 0.85);
    ctx.beginPath();
    ctx.moveTo(x - 90 * s, gy);
    ctx.lineTo(x - 20 * s, gy - 130 * s);
    ctx.lineTo(x + 20 * s, gy - 70 * s);
    ctx.lineTo(x + 70 * s, gy - 150 * s);
    ctx.lineTo(x + 110 * s, gy);
    ctx.closePath(); ctx.fill();
  },
  ring(ctx, x, gy, s, pal) {
    ctx.strokeStyle = rgba(pal.accent, 0.9);
    ctx.lineWidth = 6 * s;
    ctx.beginPath(); ctx.arc(x, gy - 70 * s, 66 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.arc(x, gy - 70 * s, 92 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  },
  factory(ctx, x, gy, s, pal) {
    ctx.fillStyle = rgba('#141922', 0.92);
    ctx.fillRect(x - 80 * s, gy - 96 * s, 160 * s, 96 * s);
    ctx.fillRect(x + 20 * s, gy - 156 * s, 30 * s, 62 * s);
    ctx.fillStyle = rgba(pal.accent, 0.5);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(x + 35 * s + i * 6 * s, gy - 168 * s - i * 26 * s, 14 * s + i * 5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/**
 * 按方案把道具沿地平线排开。
 * 槽位规则：人物在中间 → 用「内-外」两侧槽位（左右各一）；
 * 人物偏左 → 道具全部去右边；人物偏右 → 全部去左边。这样任何构图下道具都不会糊在人身上。
 */
function drawProps(ctx, plan, heroX) {
  const props = (plan.props || []).filter((k) => DRAW[k]);
  if (!props.length) return;
  const gy = VH * Math.min(0.94, plan.horizon + 0.14);
  const heroLeft = heroX < VW * 0.42;
  const heroRight = heroX > VW * 0.58;
  const slots = heroLeft ? [VW - 88, VW - 186, VW - 284]
    : heroRight ? [88, 186, 284]
      : [88, VW - 88, 172, VW - 172];
  props.forEach((k, i) => {
    const x = slots[i % slots.length];
    const s = Math.max(0.6, 1.06 - Math.floor(i / slots.length) * 0.22 - (i > 1 ? 0.08 : 0));
    DRAW[k](ctx, x, gy, s, plan.palette);
  });
}

module.exports = { VW, VH, PROPS, SCENERY, LAYOUTS, FIG_TYPES, GENDERS, HAIRS, OUTFITS, POSES, normalizePlan, drawScenery, drawProps, rgba };
