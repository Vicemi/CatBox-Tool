// PDF 导出：1:1 矢量刀线 + 专色 Separation（CutContour/Crease）+ 叠印 + TrimBox/BleedBox
// 生产稿：兼容既有视觉；专业净稿：仅四色图层、纯白纸面、无页内说明。二者均无 ICC，不宣称 PDF/X。
// 评审稿：图稿 RGB JPEG（DCTDecode）
import { geomOf } from '../dieline/geom.js';
import { drawLayer } from '../design/layers.js';
import { clipPtsOf } from '../design/containers.js';
import { TPLS } from '../dieline/templates.js';
import { itemMatrix, uniqueSheets } from './nesting.js';
import { saveFile } from '../platform.js';

const enc = new TextEncoder();
export const pdfByteLength = text => enc.encode(text).length;
export const pdfTextStream = text => '<< /Length ' + pdfByteLength(text) + ' >>\nstream\n' + text + '\nendstream';

// 通用 PDF 写出：objs 元素为字符串或 { bin: Uint8Array, pre, post }
export function writePdf(objs, fname, options = {}) {
  const parts = [], offs = [];
  let len = 0;
  const push = p => { parts.push(p); len += p.length; };
  push(enc.encode('%PDF-1.4\n'));
  objs.forEach((o, i) => {
    offs.push(len);
    push(enc.encode((i + 1) + ' 0 obj\n'));
    if (o.bin) { push(enc.encode(o.pre)); push(o.bin); push(enc.encode(o.post)); }
    else push(enc.encode(o));
    push(enc.encode('\nendobj\n'));
  });
  const xr = len;
  const trailerExtra = (options.infoRef ? ' /Info ' + options.infoRef + ' 0 R' : '');
  let tail = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R' + trailerExtra + ' >>\nstartxref\n' + xr + '\n%%EOF';
  push(enc.encode(tail));
  const out = new Uint8Array(len);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return saveFile(fname, new Blob([out], { type: 'application/pdf' }));
}

export function pageBoxes(s, g) {
  const b = s.bleed;
  const ox = g.sbb[0] - b, oy = g.sbb[1] - b;
  const Wmm = (g.sbb[2] - g.sbb[0]) + 2 * b, Hmm = (g.sbb[3] - g.sbb[1]) + 2 * b;
  const k = 72 / 25.4, Wpt = Wmm * k, Hpt = Hmm * k;
  const trim = [b * k, b * k, Wpt - b * k, Hpt - b * k].map(v => v.toFixed(2)).join(' ');
  const trimRect = [b * k, b * k, Wpt - 2 * b * k, Hpt - 2 * b * k].map(v => v.toFixed(2)).join(' ');
  return { b, ox, oy, Wmm, Hmm, k, Wpt, Hpt, trim, trimRect };
}

// 朴素 RGB→CMYK（无色彩管理）
function rgbToCmyk(img) {
  const n = img.length / 4;
  const out = new Uint8Array(n * 4);
  for (let i = 0, j = 0; i < img.length; i += 4, j += 4) {
    const r = img[i] / 255, g = img[i + 1] / 255, b = img[i + 2] / 255;
    const k = 1 - Math.max(r, g, b);
    if (k >= 0.9999) { out[j] = out[j + 1] = out[j + 2] = 0; out[j + 3] = 255; continue; }
    out[j] = Math.round((1 - r - k) / (1 - k) * 255);
    out[j + 1] = Math.round((1 - g - k) / (1 - k) * 255);
    out[j + 2] = Math.round((1 - b - k) / (1 - k) * 255);
    out[j + 3] = Math.round(k * 255);
  }
  return out;
}

export async function zlib(bytes) {
  const cs = new CompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

// 图稿画布：面板底 + 图层
async function renderArt(s, g, boxes, S, processOnly = false) {
  await document.fonts.ready;
  const cv = document.createElement('canvas');
  cv.width = Math.round(boxes.Wmm * S); cv.height = Math.round(boxes.Hmm * S);
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
  const X = v => (v - boxes.ox) * S, Y = v => (v - boxes.oy) * S;
  if (!processOnly) {
    c.fillStyle = '#fdfcf7';
    g.fills.forEach(pts => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.closePath(); c.fill(); });
  }
  c.save(); c.translate(-boxes.ox * S, -boxes.oy * S);
  for (const l of s.layers) { if (l.visible && (!processOnly || (l.finish || 'none') === 'none')) drawLayer(c, l, S, undefined, clipPtsOf(g.panels, l)); }
  c.restore();
  return cv;
}

export async function exportPDF(s, mat, mode = 'cmyk') {
  const professional = mode === 'professional';
  const missing = s.layers.filter(l => l.visible && (l.finish || 'none') === 'none' && l.kind === 'image' && !l.img);
  if (professional && missing.length) throw new Error('No se exportó el PDF limpio: hay ' + missing.length + ' capas de imagen CMYK sin cargar.');
  const g = geomOf(s, mat.t);
  const boxes = pageBoxes(s, g);
  const { b, ox, oy, Wpt, Hpt, trim, trimRect } = boxes;
  const k = boxes.k;
  const S = mode === 'rgb' ? 8 : 300 / 25.4;   // 生产/专业稿 300dpi，评审稿 ≈203dpi
  const cv = await renderArt(s, g, boxes, S, professional);
  // 图像对象
  let imgObj;
  if (mode !== 'rgb') {
    const rgba = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const cmyk = await zlib(rgbToCmyk(rgba));
    imgObj = { bin: cmyk, pre: '<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Length ' + cmyk.length + ' >>\nstream\n', post: '\nendstream' };
  } else {
    const jpg = Uint8Array.from(atob(cv.toDataURL('image/jpeg', 0.92).split(',')[1]), ch => ch.charCodeAt(0));
    imgObj = { bin: jpg, pre: '<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n', post: '\nendstream' };
  }
  const PX = v => ((v - ox) * k).toFixed(2), PY = v => (Hpt - (v - oy) * k).toFixed(2);
  const path = ty => g.segs.filter(sg => sg.t === ty).map(sg =>
    sg.pts.map((p, i) => PX(p[0]) + ' ' + PY(p[1]) + (i ? ' l' : ' m')).join(' ') + ' S').join('\n');
  const info = (TPLS.find(x => x.id === s.tpl) || {}).code + ' ' + s.L + 'x' + s.W + 'x' + s.H + 'mm t=' + mat.t + ' bleed=' + b + 'mm scale 1:1 ' + (mode === 'rgb' ? 'RGB' : 'CMYK');
  // 刀线描边：生产稿 = 专色 Separation 叠印（RIP/Acrobat）；评审稿 = DeviceRGB（任何查看器可见）
  const dieline = mode !== 'rgb'
    ? '/OP1 gs\n/CS2 CS 1 SCN 0.9 w\n' + path('crease') + '\n/CS1 CS 1 SCN 0.9 w\n' + path('cut') + '\n'
    : '0.9 w 0.18 0.49 0.27 RG\n' + path('crease') + '\n0.9 w 0.78 0.06 0.18 RG\n' + path('cut') + '\n';
  // 专业净稿只保留四色图稿与专色刀线；兼容生产稿/评审稿继续保留可视说明。
  const marks = professional ? '' : '0.4 w 0.55 0.55 0.55 RG [2 2] 0 d ' + trimRect + ' re S [] 0 d\n'
    + 'BT /F1 7 Tf 0.13 0.11 0.09 rg 6 ' + (Hpt - 11).toFixed(2) + ' Td (' + info + ') Tj ET\n'
    + 'BT /F1 6 Tf 0.78 0.06 0.18 rg 6 ' + (Hpt - 20).toFixed(2) + ' Td (ROJO = CORTE' + (mode === 'cmyk' ? ' / CutContour spot' : '') + ') Tj ET\n'
    + 'BT /F1 6 Tf 0.18 0.49 0.27 rg 6 ' + (Hpt - 28).toFixed(2) + ' Td (VERDE = PLIEGUE' + (mode === 'cmyk' ? ' / Crease spot' : '') + ' / RECORTE ' + b + 'mm) Tj ET\n';
  const content = 'q ' + Wpt.toFixed(2) + ' 0 0 ' + Hpt.toFixed(2) + ' 0 0 cm /Im0 Do Q\n' + marks + dieline;
  const sep = (name, cmyk) => '[ /Separation /' + name + ' /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [' + cmyk + '] /N 1 >> ]';
  const created = new Date().toISOString();
  const catalog = '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >>'
    + (professional ? ' /Metadata 8 0 R' : '') + ' >>';
  const objs = [
    catalog,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + Wpt.toFixed(2) + ' ' + Hpt.toFixed(2) + '] /TrimBox [' + trim + '] /BleedBox [0 0 ' + Wpt.toFixed(2) + ' ' + Hpt.toFixed(2) + ']'
      + ' /CropBox [0 0 ' + Wpt.toFixed(2) + ' ' + Hpt.toFixed(2) + ']'
      + ' /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> /ColorSpace << /CS1 ' + sep('CutContour', '0 1 1 0') + ' /CS2 ' + sep('Crease', '1 0 1 0') + ' >> /ExtGState << /OP1 << /OP true /op true /OPM 1 >> >> >> /Contents 6 0 R >>',
    imgObj,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    pdfTextStream(content)
  ];
  if (professional) {
    const xmp = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
      + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
      + '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">'
      + '<dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Box3D Professional Print</rdf:li></rdf:Alt></dc:title>'
      + '<xmp:CreatorTool>Box3D Exporter</xmp:CreatorTool><xmp:CreateDate>' + created + '</xmp:CreateDate>'
      + '<pdf:Producer>Box3D Exporter</pdf:Producer><pdf:Keywords>CMYK process-only; spot dieline; color management unspecified</pdf:Keywords>'
      + '</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>';
    objs.push('<< /Title (Box3D Professional Print) /Creator (Box3D Exporter) /Producer (Box3D Exporter) /Subject (CMYK process-only artwork with spot dieline; no ICC or PDF/X claim) /Trapped /False >>');
    objs.push('<< /Type /Metadata /Subtype /XML /Length ' + pdfByteLength(xmp) + ' >>\nstream\n' + xmp + '\nendstream');
  }
  const suffix = professional ? '_professional' : mode === 'cmyk' ? '_cmyk' : '';
  return writePdf(objs, s.tpl + '_' + s.L + 'x' + s.W + 'x' + s.H + suffix + '_print.pdf', professional ? { infoRef: 7 } : {});
}

// Plancha(s) con la red repetida: una sola imagen de arte reutilizada por cada colocación,
// troquel vectorial por pieza y marcas de corte / registro en el margen. Huella de pieza = red + sangrado.
// info = { margin }. Sin metadatos XMP del modo «professional» (shortcut: solo hacen falta en la salida individual).
export async function exportNestedPDF(s, mat, mode, res, sheetW, sheetH, info = {}) {
  const missing = s.layers.filter(l => l.visible && (l.finish || 'none') === 'none' && l.kind === 'image' && !l.img);
  if (mode === 'professional' && missing.length) throw new Error('No se exportó el PDF limpio: hay ' + missing.length + ' capas de imagen CMYK sin cargar.');
  const g = geomOf(s, mat.t);
  const boxes = pageBoxes(s, g);
  const { ox, oy, Wmm, Hmm, k } = boxes;
  const cv = await renderArt(s, g, boxes, mode === 'rgb' ? 8 : 300 / 25.4, mode === 'professional');
  let imgObj;
  if (mode !== 'rgb') {
    const cmyk = await zlib(rgbToCmyk(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data));
    imgObj = { bin: cmyk, pre: '<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Length ' + cmyk.length + ' >>\nstream\n', post: '\nendstream' };
  } else {
    const jpg = Uint8Array.from(atob(cv.toDataURL('image/jpeg', 0.92).split(',')[1]), ch => ch.charCodeAt(0));
    imgObj = { bin: jpg, pre: '<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n', post: '\nendstream' };
  }
  const SWp = sheetW * k, SHp = sheetH * k, f2 = v => v.toFixed(2);
  const sep = (name, cmyk) => '[ /Separation /' + name + ' /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [' + cmyk + '] /N 1 >> ]';
  const resources = '<< /XObject << /Im0 3 0 R >> /ColorSpace << /CS1 ' + sep('CutContour', '0 1 1 0') + ' /CS2 ' + sep('Crease', '1 0 1 0') + ' >> /ExtGState << /OP1 << /OP true /op true /OPM 1 >> >> >>';
  const m = info.margin || 0;
  const regCol = mode === 'rgb' ? '0 0 0 RG' : '1 1 1 1 K';
  // marcas de corte en las esquinas del área útil y dianas de registro en mitad de cada borde (solo si el margen las admite)
  const marks = m < 6 ? '' : (() => {
    const P = (x, y) => f2(x * k) + ' ' + f2((sheetH - y) * k), L = (x1, y1, x2, y2) => P(x1, y1) + ' m ' + P(x2, y2) + ' l S\n';
    let o = regCol + ' 0.25 w\n';
    for (const [cx, cy, dx, dy] of [[m, m, -1, -1], [sheetW - m, m, 1, -1], [m, sheetH - m, -1, 1], [sheetW - m, sheetH - m, 1, 1]])
      o += L(cx + dx * 1, cy, cx + dx * 5, cy) + L(cx, cy + dy * 1, cx, cy + dy * 5);
    const r = 1.5, c = 0.5523 * r;
    for (const [cx, cy] of [[sheetW / 2, m / 2], [m / 2, sheetH / 2]]) {
      const x = cx * k, y = (sheetH - cy) * k, R = r * k, C = c * k;
      o += f2(x + R) + ' ' + f2(y) + ' m ' + [[x + R, y + C, x + C, y + R, x, y + R], [x - C, y + R, x - R, y + C, x - R, y], [x - R, y - C, x - C, y - R, x, y - R], [x + C, y - R, x + R, y - C, x + R, y]].map(a => a.map(f2).join(' ') + ' c').join(' ') + ' S\n';
      o += L(cx - 3, cy, cx + 3, cy) + L(cx, cy - 3, cx, cy + 3);
    }
    return o;
  })();
  const pages = uniqueSheets(res).map(u => {
    let body = '', cuts = '', creases = '';
    u.items.forEach(p => {
      const [a, b, c, d, e, f] = itemMatrix(p, Hmm);
      body += 'q ' + [Wmm * a * k, -Wmm * b * k, -Hmm * c * k, Hmm * d * k, (e + c * Hmm) * k, (sheetH - f - d * Hmm) * k].map(f2).join(' ') + ' cm /Im0 Do Q\n';
      const pt = q => { const u2 = q[0] - ox, v2 = q[1] - oy; return f2((a * u2 + c * v2 + e) * k) + ' ' + f2((sheetH - (b * u2 + d * v2 + f)) * k); };
      const path = sg => sg.pts.map((q, i) => pt(q) + (i ? ' l' : ' m')).join(' ') + ' S\n';
      g.segs.forEach(sg => { if (sg.t === 'cut') cuts += path(sg); else if (sg.t === 'crease') creases += path(sg); });
    });
    const dieline = mode !== 'rgb'
      ? '/OP1 gs\n/CS2 CS 1 SCN 0.9 w\n' + creases + '/CS1 CS 1 SCN 0.9 w\n' + cuts
      : '0.9 w 0.18 0.49 0.27 RG\n' + creases + '0.9 w 0.78 0.06 0.18 RG\n' + cuts;
    return { content: body + marks + dieline, repeat: u.repeat };
  });
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>',
    '<< /Type /Pages /Kids [' + pages.map((_, i) => (5 + 2 * i) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>',
    imgObj,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  pages.forEach((pg, i) => {
    const box = '[0 0 ' + f2(SWp) + ' ' + f2(SHp) + ']';
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox ' + box + ' /TrimBox ' + box + ' /BleedBox ' + box + ' /CropBox ' + box + ' /Resources ' + resources + ' /Contents ' + (6 + 2 * i) + ' 0 R >>');
    objs.push(pdfTextStream(pg.content));
  });
  return writePdf(objs, 'nesting_' + s.tpl + '_' + s.L + 'x' + s.W + 'x' + s.H + '_' + res.count + 'pzs_print.pdf');
}
