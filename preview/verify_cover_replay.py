# -*- coding: utf-8 -*-
"""封面绘制验证器（第 2 步）：按 record_cover.js 录下的真实画布调用重放成 PNG。
   这样看到的就是小程序里封面绘制函数的真实输出。"""
import json
import math
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

LOG = sys.argv[1] if len(sys.argv) > 1 else 'cover_log.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'cover_replay.png'
W, H = 600, 800
FONT_B = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_R = r"C:\Windows\Fonts\msyh.ttc"
_font_cache = {}


def font(size, bold):
    key = (int(round(size)), bold)
    if key not in _font_cache:
        try:
            _font_cache[key] = ImageFont.truetype(FONT_B if bold else FONT_R, max(1, int(round(size))))
        except Exception:
            _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]


def parse_color(c):
    """支持 #rrggbb / rgba(r,g,b,a) / rgb()"""
    if not isinstance(c, str):
        return (0, 0, 0, 255)
    c = c.strip()
    if c.startswith('#'):
        h = c[1:]
        if len(h) == 3:
            h = ''.join(ch * 2 for ch in h)
        n = int(h, 16)
        return ((n >> 16) & 255, (n >> 8) & 255, n & 255, 255)
    m = re.match(r'rgba?\(([^)]+)\)', c)
    if m:
        parts = [p.strip() for p in m.group(1).split(',')]
        r, g, b = (int(float(parts[i])) for i in range(3))
        a = int(float(parts[3]) * 255) if len(parts) > 3 else 255
        return (r, g, b, a)
    return (0, 0, 0, 255)


def grad_image(size, g):
    """把渐变渲染成整幅 RGBA 图（用于按路径裁剪填充）"""
    img = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    stops = g['stops']
    if not stops:
        return img

    def color_at(t):
        t = max(0.0, min(1.0, t))
        for i in range(len(stops) - 1):
            o0, c0 = stops[i]
            o1, c1 = stops[i + 1]
            if o0 <= t <= o1:
                k = 0 if o1 == o0 else (t - o0) / (o1 - o0)
                a = parse_color(c0)
                b = parse_color(c1)
                return tuple(int(a[j] + (b[j] - a[j]) * k) for j in range(4))
        return parse_color(stops[-1][1])
    if g['type'] == 'linear':
        x0, y0, x1, y1 = g['p']
        dx, dy = x1 - x0, y1 - y0
        den = dx * dx + dy * dy
        if den == 0:
            return img
        # 逐列/逐行扫描：按投影参数 t 上色
        for y in range(size[1]):
            for_ = []
            for x in range(0, size[0], 2):
                t = ((x - x0) * dx + (y - y0) * dy) / den
                for_.append((x, color_at(t)))
                for_.append((x + 1, color_at(t)))
            for x, c in for_:
                if x < size[0]:
                    img.putpixel((x, y), c)
    else:
        x0, y0, r0, x1, y1, r1 = g['p']
        for y in range(size[1]):
            for x in range(size[0]):
                dd = math.hypot(x - x1, y - y1)
                t = 0 if r1 == r0 else (dd - r0) / (r1 - r0)
                img.putpixel((x, y), color_at(t))
    return img


def qbez(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in [i / n for i in range(n + 1)]]


def cbez(p0, p1, p2, p3, n=30):
    out = []
    for i in range(n + 1):
        t = i / n
        m = 1 - t
        out.append((m ** 3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t ** 3 * p3[0],
                    m ** 3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t ** 3 * p3[1]))
    return out


class CTM:
    def __init__(self):
        self.a, self.b, self.c, self.d, self.e, self.f = 1, 0, 0, 1, 0, 0

    def copy(self):
        m = CTM()
        m.a, m.b, m.c, m.d, m.e, m.f = self.a, self.b, self.c, self.d, self.e, self.f
        return m

    def apply(self, x, y):
        return (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)

    def translate(self, x, y):
        self.e += self.a * x + self.c * y
        self.f += self.b * x + self.d * y

    def scale(self, x, y):
        self.a *= x
        self.c *= y
        self.b *= x
        self.d *= y


def replay(log, size=(W, H)):
    img = Image.new('RGBA', size, (0, 0, 0, 255))
    st = {'fillStyle': 'rgba(0,0,0,1)', 'strokeStyle': 'rgba(0,0,0,1)', 'lineWidth': 1.0,
          'font': '20px sans-serif', 'fontSize': 20.0, 'bold': False,
          'textAlign': 'center', 'textBaseline': 'middle', 'shadowBlur': 0, 'globalAlpha': 1.0}
    stack = []
    ctm = CTM()
    subs = []       # 当前路径的各子路径
    cur = []

    def flush():
        nonlocal cur
        if len(cur) > 1:
            subs.append(cur[:])
        cur = []

    def fill_with(color_or_grad):
        if not subs:
            return
        if isinstance(color_or_grad, dict):
            g = grad_image(size, color_or_grad)
            mask = Image.new('L', size, 0)
            md = ImageDraw.Draw(mask)
            for p in subs:
                md.polygon(p, fill=255)
            img.paste(g, (0, 0), mask)
        else:
            lay = Image.new('RGBA', size, (0, 0, 0, 0))
            d = ImageDraw.Draw(lay)
            col = parse_color(color_or_grad)
            for p in subs:
                d.polygon(p, fill=col)
            img.alpha_composite(lay)

    for op in log:
        if 'p' in op:  # 属性赋值
            k, v = op['p'], op['v']
            if k == 'font':
                st['font'] = v
                m = re.search(r'(\d+(?:\.\d+)?)px', v)
                st['fontSize'] = float(m.group(1)) if m else 20
                st['bold'] = bool(re.search(r'\bbold\b', v))
            else:
                st[k] = v
            continue
        m = op['m']
        a = op.get('a', [])
        if m == 'beginPath':
            subs, cur = [], []
        elif m == 'closePath':
            if cur:
                cur.append(cur[0])
            flush()
        elif m == 'moveTo':
            flush()
            cur = [ctm.apply(*a)]
        elif m == 'lineTo':
            cur.append(ctm.apply(*a))
        elif m == 'quadraticCurveTo':
            if cur:
                path = qbez(cur[-1], ctm.apply(a[0], a[1]), ctm.apply(a[2], a[3]))
                cur.extend(path[1:])
        elif m == 'bezierCurveTo':
            if cur:
                path = cbez(cur[-1], ctm.apply(a[0], a[1]), ctm.apply(a[2], a[3]), ctm.apply(a[4], a[5]))
                cur.extend(path[1:])
        elif m == 'arc':
            x, y, r, s, e, ccw = a[0], a[1], a[2], a[3], a[4], a[5]
            n = 48
            if e - s >= 2 * math.pi - 1e-6:
                pts = [(x + r * math.cos(2 * math.pi * i / n + s), y + r * math.sin(2 * math.pi * i / n + s))
                       for i in range(n + 1)]
            else:
                pts = [(x + r * math.cos(s + (e - s) * i / n), y + r * math.sin(s + (e - s) * i / n))
                       for i in range(n + 1)]
            pts = [ctm.apply(px, py) for px, py in pts]
            if not cur:
                cur = pts
            else:
                cur.extend(pts)
        elif m == 'rect':
            x, y, w, h = a
            cur.extend([ctm.apply(x, y), ctm.apply(x + w, y), ctm.apply(x + w, y + h),
                        ctm.apply(x, y + h), ctm.apply(x, y)])
            flush()
        elif m == 'fill':
            fill_with(st['fillStyle'])
            subs, cur = [], []
        elif m == 'stroke':
            if cur:
                flush()
            if subs:
                lay = Image.new('RGBA', size, (0, 0, 0, 0))
                d = ImageDraw.Draw(lay)
                lw = max(1, int(round(st['lineWidth'] * abs(ctm.a))))
                col = parse_color(st['strokeStyle'])
                for p in subs:
                    d.line(p, fill=col, width=lw, joint='curve')
                img.alpha_composite(lay)
            subs, cur = [], []
        elif m == 'fillRect':
            x, y, w, h = a
            p = [ctm.apply(x, y), ctm.apply(x + w, y), ctm.apply(x + w, y + h), ctm.apply(x, y + h)]
            style = st['fillStyle']
            if isinstance(style, dict):
                g = grad_image(size, style)
                mask = Image.new('L', size, 0)
                ImageDraw.Draw(mask).polygon(p, fill=255)
                img.paste(g, (0, 0), mask)
            else:
                lay = Image.new('RGBA', size, (0, 0, 0, 0))
                ImageDraw.Draw(lay).polygon(p, fill=parse_color(style))
                img.alpha_composite(lay)
        elif m == 'fillText':
            text, x, y = a
            fs = st['fontSize'] * abs(ctm.a)
            f = font(fs, st['bold'])
            d0 = ImageDraw.Draw(img)
            tw = d0.textlength(text, font=f)
            px, py = ctm.apply(x, y)
            if st['textAlign'] == 'center':
                px -= tw / 2
            elif st['textAlign'] == 'right':
                px -= tw
            lay = Image.new('RGBA', size, (0, 0, 0, 0))
            ImageDraw.Draw(lay).text((px, py), text, font=f, fill=parse_color(st['fillStyle']), anchor='lm')
            img.alpha_composite(lay)
        elif m == 'save':
            stack.append((dict(st), ctm.copy()))
        elif m == 'restore':
            if stack:
                s2, m2 = stack.pop()
                st = s2
                ctm = m2
        elif m == 'translate':
            ctm.translate(*a)
        elif m == 'scale':
            ctm.scale(*a)
    return img.convert('RGB')


def main():
    logs = json.load(open(LOG, encoding='utf-8'))
    keys = list(logs.keys())
    cols = 6
    rows = math.ceil(len(keys) / cols)
    cw, ch, pad = 150, 200, 6
    sheet = Image.new('RGB', (cols * cw + (cols + 1) * pad, rows * ch + (rows + 1) * pad), (240, 241, 244))
    for i, k in enumerate(keys):
        im = replay(logs[k]).resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (pad + (i % cols) * (cw + pad), pad + (i // cols) * (ch + pad)))
    sheet.save(OUT)
    print(f'{len(keys)} 张已重放 → {OUT}  （每行 6 张 = 6 款：3 版式 × 2 配色，每行一个题材）')


if __name__ == '__main__':
    main()


def single(log_key, out, size=(W, H)):
    """渲染单张大图，便于细看人物"""
    logs = json.load(open(LOG, encoding='utf-8'))
    replay(logs[log_key], size).save(out)
    print('saved', out)
