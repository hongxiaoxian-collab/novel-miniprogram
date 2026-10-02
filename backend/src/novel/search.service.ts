import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { stripTags, diceSimilar } from '../common/text';
import * as https from 'https';
import * as http from 'http';

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
  source: string; // bing / baidu / 站内
}

/**
 * 真实联网检索。
 * 为什么必须有它：查重以前全靠 AI "联网检索"——其实 bot 未必真的联网，
 * 于是作品名是它凭印象编的，每次结论都不一样、换了名还是"撞车"，作者被折腾得够呛。
 * 这里由后端亲自发请求抓真实结果，再把**真实原文**喂给 AI 做判断，
 * 并把命中的在榜作品存进本地库（HotBook），之后可直接本地比对，结论稳定可复现。
 */
@Injectable()
export class SearchService {
  private readonly log = new Logger(SearchService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 带超时的 GET，返回 HTML 文本 */
  private get(url: string, ms = 15000): Promise<string> {
    return new Promise((resolve) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(
        url,
        {
          timeout: ms,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept-Encoding': 'identity',
          },
        },
        (res) => {
          if (res.statusCode !== 200) { res.resume(); resolve(''); return; }
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { buf += c; if (buf.length > 400000) res.destroy(); });
          res.on('end', () => resolve(buf));
          res.on('error', () => resolve(buf));
        },
      );
      req.on('error', () => resolve(''));
      req.setTimeout(ms, () => { req.destroy(); resolve(''); });
    });
  }

  /** Bing 结果解析：每条 <li class="b_algo"> 里 h2 是标题、p 是摘要 */
  private parseBing(html: string): SearchHit[] {
    const out: SearchHit[] = [];
    const blocks = html.split('b_algo').slice(1, 12);
    for (const b of blocks) {
      const h2 = b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const a = b.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i);
      const title = h2 ? stripTags(h2[1]) : '';
      if (!title) continue;
      out.push({
        title: title.slice(0, 80),
        snippet: (p ? stripTags(p[1]) : '').slice(0, 200),
        url: a ? a[1] : '',
        source: 'bing',
      });
    }
    return out;
  }

  /** 百度结果解析（Bing 不通时的兜底） */
  private parseBaidu(html: string): SearchHit[] {
    const out: SearchHit[] = [];
    const re = /<h3[^>]*class="[^"]*t[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,600}?<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(html)) && n < 12) {
      const title = stripTags(m[1]);
      if (!title) continue;
      out.push({ title: title.slice(0, 80), snippet: stripTags(m[2]).slice(0, 200), url: '', source: 'baidu' });
      n++;
    }
    return out;
  }

  /** 从正文里抠书名号包裹的作品名（搜索结果里小说名常带《》） */
  private titlesFromText(text: string): string[] {
    const set: string[] = [];
    const re = /《([^《》]{2,30})》/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const t = m[1].trim();
      if (t && set.indexOf(t) < 0) set.push(t);
      if (set.length >= 20) break;
    }
    return set;
  }

  /** 联网搜一个词，返回真实结果（Bing 优先，失败退百度） */
  async search(q: string): Promise<SearchHit[]> {
    if (!q) return [];
    const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(q) + '&ensearch=0';
    let hits = this.parseBing(await this.get(url));
    if (!hits.length) {
      hits = this.parseBaidu(await this.get('https://www.baidu.com/s?wd=' + encodeURIComponent(q)));
    }
    // 摘要里提到的书名也算命中（很多同名书只在摘要里出现）
    const extra: SearchHit[] = [];
    hits.forEach((h) => this.titlesFromText(h.title + ' ' + h.snippet).forEach((t) => {
      if (t !== h.title) extra.push({ title: t, snippet: h.snippet, url: h.url, source: h.source });
    }));
    const all = hits.concat(extra);
    this.log.log(`检索「${q}」→ ${hits.length} 条结果，书名 ${all.length} 个`);
    return all;
  }

  /** 从 URL 判断是哪个平台（作者要的就是"跟番茄、七猫的在榜作品比"） */
  private platformOf(url: string, text: string): string {
    const s = (url || '') + ' ' + (text || '');
    if (/fanqienovel|fanqie|番茄/i.test(s)) return '番茄';
    if (/qimao|七猫/i.test(s)) return '七猫';
    return '全网';
  }

  /**
   * 定向检索"这部书在番茄 / 七猫上有没有同名的"：
   * 用 site: 限定站内 + 通用小说关键词双管齐下，结果按平台归类。
   */
  async searchNovel(title: string, extraKeywords = ''): Promise<SearchHit[]> {
    const t = String(title || '').replace(/[《》]/g, '').trim();
    if (!t) return [];
    const q = (s: string) => s.trim();
    const queries = [
      q(`${t} 小说`),
      q(`site:fanqienovel.com ${t}`),
      q(`site:qimao.com ${t}`),
      extraKeywords ? q(`${t} ${extraKeywords}`) : '',
    ].filter(Boolean);
    // 并发发请求：逐个 await 会串行 3~4 次往返，批量预检 4 个候选名就慢到不可用
    const groups = await Promise.all(queries.map((qq) => this.search(qq).catch(() => [] as SearchHit[])));
    const seen = new Set<string>();
    const out: SearchHit[] = [];
    for (const hits of groups) {
      for (const h of hits) {
        const t2 = h.title.replace(/[《》]/g, '').trim();
        if (!t2 || seen.has(t2)) continue;
        seen.add(t2);
        out.push({ ...h, source: this.platformOf(h.url, h.title + ' ' + h.snippet) });
      }
      if (out.length >= 12) break;
    }
    return out.slice(0, 16);
  }

  /**
   * 把检索到的在榜作品存进本地库（去重、累加命中次数）。
   * 攒起来之后，同名比对可以直接本地做，不必每次都联网、结论也不再随机漂移。
   */
  async collect(hits: SearchHit[], query: string) {
    for (const h of hits) {
      const t = h.title.replace(/[《》]/g, '').trim();
      if (!t || t.length < 2 || t.length > 60) continue;
      try {
        const exist = await (this.prisma as any).hotBook.findFirst({ where: { title: t } });
        if (exist) {
          await (this.prisma as any).hotBook.update({
            where: { id: exist.id },
            data: { hits: (exist.hits || 0) + 1, snippet: h.snippet || exist.snippet, url: h.url || exist.url },
          });
        } else {
          await (this.prisma as any).hotBook.create({
            data: { title: t, snippet: h.snippet || '', url: h.url || '', source: h.source || 'bing', query: query.slice(0, 120) },
          });
        }
      } catch (e) { /* 库没同步就跳过，不阻塞查重 */ }
    }
  }

  /**
   * 本地在榜库比对：完全由代码算相似度，结果稳定可复现（不靠 AI 抽样）。
   * 返回相似度 >= threshold 的真实作品，附真实摘录作为证据。
   */
  async localMatches(title: string, threshold = 0.62) {
    let rows: any[] = [];
    try { rows = await (this.prisma as any).hotBook.findMany({ orderBy: { hits: 'desc' }, take: 400 }); } catch (e) { return []; }
    const out: any[] = [];
    for (const r of rows) {
      const s = diceSimilar(title, r.title);
      if (s >= threshold) out.push({ title: r.title, similarity: Number(s.toFixed(2)), snippet: r.snippet, url: r.url, source: r.source });
    }
    return out.sort((a, b) => b.similarity - a.similarity).slice(0, 8);
  }
}
