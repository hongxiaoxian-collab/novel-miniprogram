/**
 * 零依赖 .docx 生成器。
 * .docx 本质是一个 zip 包，里面放 OOXML 的 xml 文件；这里手写 zip（不压缩，store 方式）
 * 和最小 OOXML，不引入任何第三方库，服务器上不需要 npm install。
 */
import { Buffer } from 'buffer';

// ---------- zip（store，不压缩；Word / WPS / 微信文档预览都能打开） ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);   // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(0, 8);    // store
    local.writeUInt16LE(0, 10);   // time
    local.writeUInt16LE(0x21, 12); // date（固定值即可）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, f.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42); // 本地头偏移
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + f.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------- OOXML ----------
function esc(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 把多行文本转成 Word 段落；每个空行 = 一个段落，段内软换行用 <w:br/> */
function paras(text: string, opt: { size?: number; bold?: boolean; indent?: boolean; align?: string } = {}): string {
  const size = opt.size || 24; // half-point：24 = 12pt = 小四
  const rpr = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/>`
    + (opt.bold ? '<w:b/>' : '')
    + `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const ppr = `<w:pPr>${opt.align ? `<w:jc w:val="${opt.align}"/>` : ''}`
    + (opt.indent ? '<w:ind w:firstLine="480"/>' : '')
    + '<w:spacing w:line="360" w:lineRule="auto" w:after="80"/></w:pPr>';
  return String(text == null ? '' : text)
    .split('\n')
    .map((line) => `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
    .join('');
}

export interface DocxSection {
  heading?: string;   // 小标题（加粗）
  text?: string;      // 正文（\n 分段）
  indent?: boolean;   // 首行缩进（章节正文用）
  breakBefore?: boolean; // 另起一页
}

/** 生成 docx：title 用作书名页标题 */
export function buildDocx(title: string, sections: DocxSection[]): Buffer {
  const body = [
    paras(title, { size: 44, bold: true, align: 'center' }), // 标题：22pt 居中
    ...sections.map((s) => {
      const parts: string[] = [];
      if (s.breakBefore) parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      if (s.heading) parts.push(paras(s.heading, { size: 32, bold: true }));
      if (s.text) parts.push(paras(s.text, { indent: s.indent }));
      return parts.join('');
    }),
  ].join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  // 带上 styles.xml + 其 rels：部分严格解析器（如微信文档预览）缺这两块会打不开
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(styles, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ]);
}

/** 文件名里的非法字符要清掉，中文保留 */
export function safeFileName(name: string): string {
  return String(name || '未命名作品').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60);
}
