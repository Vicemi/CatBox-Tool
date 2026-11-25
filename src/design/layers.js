// Modelo de capas: caja envolvente, DPI y avisos de pliegue / salida de cara.
export const FIN = { none: '', foil: 'Oro', silver: 'Plata', uv: 'UV', gloss: 'Brillo', emboss: 'Relieve', holo: 'Holo' };
export const FIN_NAMES = { foil: 'Estampado oro', silver: 'Estampado plata', uv: 'UV local', gloss: 'Brillo', emboss: 'Relieve', holo: 'Holográfico' };
export const randomImageName = () => 'Imagen·' + Math.random().toString(36).slice(2, 6).toUpperCase();
export const layerNameOf = l => {
  if (l && typeof l.name === 'string' && l.name.trim()) return l.name.trim();
  if (l && l.kind === 'image') return 'Imagen·' + Number(l.id || 0).toString(36).toUpperCase().padStart(4, '0').slice(-4);
  return l && l.content || '(vacío)';
};

export const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'], ['darken', 'Oscurecer'], ['lighten', 'Aclarar'], ['soft-light', 'Luz suave'], ['hard-light', 'Luz fuerte'], ['difference', 'Diferencia']];
export const FONTS = ['Noto Sans', 'Noto Serif', 'JetBrains Mono', 'Tomcat'];
export const SHAPES = ['rect', 'ellipse', 'triangle', 'polygon', 'star', 'line'];

// Medición real del texto (canvas) con caché; sin DOM (tests) cae a una estimación por carácter.
let mctx = null;
const widthCache = new Map();
function lineWidth(l, line) {
  const chars = [...line].length, ls = (l.letterSpacing || 0) * chars;
  if (typeof document === 'undefined') return [...line].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 1 : 0.55), 0) * l.size + ls;
  const font = (l.italic ? 'italic ' : '') + (l.weight || 400) + ' 100px "' + (l.font || 'Noto Sans') + '"', key = font + '|' + line;
  let m = widthCache.get(key);
  if (m == null) {
    mctx = mctx || document.createElement('canvas').getContext('2d');
    mctx.font = font; m = mctx.measureText(line).width / 100;
    if (document.fonts && document.fonts.check(font)) widthCache.set(key, m); // si la fuente aún carga, no cachear
  }
  return m * l.size + ls;
}
// Métricas de texto: líneas, anchura sin escalar y caja (x = centro de la caja; y = línea base de la 1.ª línea).
export function textMetrics(l) {
  const lines = String(l.content || '').split('\n'), lh = l.lineHeight == null ? 1.15 : l.lineHeight;
  const w0 = Math.max(2, ...lines.map(x => lineWidth(l, x))), h0 = l.size * 1.15 + (lines.length - 1) * l.size * lh;
  return { lines, lh, w0, h0, cy: l.y - l.size * 0.92 + h0 / 2, ax: l.align === 'left' ? l.x - w0 / 2 : l.align === 'right' ? l.x + w0 / 2 : l.x, anchor: l.align === 'left' ? 'start' : l.align === 'right' ? 'end' : 'middle' };
}

export function bboxOf(l) {
  if (l.kind === 'text') {
    const m = textMetrics(l), sx = l.scaleX == null ? 1 : l.scaleX, sy = l.scaleY == null ? 1 : l.scaleY;
    const w = m.w0 * sx, h = m.h0 * sy;
    return [l.x - w / 2, m.cy - h / 2, w, h];
  }
  return [l.x, l.y, l.w, l.h];
}

// Caja alineada a los ejes que ocupa la capa tras girarla (para alinear, imanes y marquesina).
export function rotBBox(l) {
  const b = bboxOf(l), r = (l.rot || 0) * Math.PI / 180;
  if (!r) return b;
  const co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r)), w = b[2] * co + b[3] * si, h = b[2] * si + b[3] * co, cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  return [cx - w / 2, cy - h / 2, w, h];
}

// Contorno de una forma en mm (sin giro): el mismo path sirve para el SVG del lienzo y para Path2D en 2D/PDF/3D.
export function shapePathD(l) {
  const x = l.x, y = l.y, w = l.w, h = l.h, kind = l.shape || 'rect', f = v => Math.round(v * 1000) / 1000;
  const poly = pts => 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z';
  const cx = x + w / 2, cy = y + h / 2;
  if (kind === 'line') return 'M' + f(x) + ' ' + f(cy) + 'L' + f(x + w) + ' ' + f(cy);
  if (kind === 'ellipse') return 'M' + f(x) + ' ' + f(cy) + 'A' + f(w / 2) + ' ' + f(h / 2) + ' 0 1 0 ' + f(x + w) + ' ' + f(cy) + 'A' + f(w / 2) + ' ' + f(h / 2) + ' 0 1 0 ' + f(x) + ' ' + f(cy) + 'Z';
  if (kind === 'triangle') return poly([[cx, y], [x + w, y + h], [x, y + h]]);
  if (kind === 'polygon' || kind === 'star') {
    const n = Math.max(3, Math.min(24, Math.round(l.sides || (kind === 'star' ? 5 : 6)))), pts = [], inner = kind === 'star' ? (l.innerR == null ? 0.45 : l.innerR) : 1;
    for (let i = 0; i < (kind === 'star' ? n * 2 : n); i++) {
      const a = -Math.PI / 2 + (kind === 'star' ? i * Math.PI / n : i * 2 * Math.PI / n), rr = kind === 'star' && i % 2 ? inner : 1;
      pts.push([cx + Math.cos(a) * w / 2 * rr, cy + Math.sin(a) * h / 2 * rr]);
    }
    return poly(pts);
  }
  const r = Math.max(0, Math.min(l.radius || 0, w / 2, h / 2));
  if (!r) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return 'M' + f(x + r) + ' ' + f(y) + 'H' + f(x + w - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + w) + ' ' + f(y + r) + 'V' + f(y + h - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + w - r) + ' ' + f(y + h) + 'H' + f(x + r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x) + ' ' + f(y + h - r) + 'V' + f(y + r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x + r) + ' ' + f(y) + 'Z';
}
// Firma de estilo de una capa: BoxPreview.bakeKey (render3d) debe incluirla para re-hornear el 3D al cambiar estos campos.
export const layerStyleKey = l => [l.blend, l.flipX, l.flipY, l.shape, l.stroke, l.strokeW, l.radius, l.sides, l.innerR, l.fillOn, l.italic, l.letterSpacing, l.lineHeight, l.align].join('|');

export function dpiOf(l) {
  if (l.kind !== 'image' || !l.pxw) return 0;
  return Math.round(l.pxw / (l.w / 25.4));
}

// Cajas de panel para el atlas UV (exportación y 3D alineados)
export function panelBoxes(g) {
  return g.fills.map(pts => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return [x0, y0, x1, y1];
  });
}

export function warnsOf(l, creaseSegs, sbb) {
  const b = bboxOf(l), out = [];
  // Una capa vinculada a una cara se recorta en todos los canales; salir de la cara ya no es un fallo.
  if (l.panelId == null) {
    for (const seg2 of creaseSegs) {
      const p1 = seg2[0], p2 = seg2[1];
      if (Math.abs(p1[0] - p2[0]) < 0.01) {
        const cx = p1[0], y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
        if (cx > b[0] && cx < b[0] + b[2] && y0 < b[1] + b[3] && y1 > b[1]) { out.push('Cruza un pliegue: el dibujo puede romperse o deformarse'); break; }
      } else if (Math.abs(p1[1] - p2[1]) < 0.01) {
        const cy = p1[1], x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]);
        if (cy > b[1] && cy < b[1] + b[3] && x0 < b[0] + b[2] && x1 > b[0]) { out.push('Cruza un pliegue: el dibujo puede romperse o deformarse'); break; }
      }
    }
    if (b[0] < sbb[0] - 0.5 || b[1] < sbb[1] - 0.5 || b[0] + b[2] > sbb[2] + 0.5 || b[1] + b[3] > sbb[3] + 0.5) out.push('Fuera del despliegue: entra en sangrado o zona de recorte');
  }
  if (l.kind === 'image') { const dpi = dpiOf(l); if (dpi < 300) out.push('Resolución insuficiente: ' + dpi + ' dpi < 300 dpi'); }
  return out;
}

// Máscara efectiva de una imagen de acabado: RGB a blanco, alfa = luminancia × alfa original.
const craftMaskCache = new WeakMap();
function craftMaskOf(img) {
  let m = craftMaskCache.get(img);
  if (m) return m;
  m = document.createElement('canvas');
  m.width = img.naturalWidth; m.height = img.naturalHeight;
  const mg = m.getContext('2d');
  mg.drawImage(img, 0, 0);
  const d = mg.getImageData(0, 0, m.width, m.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = Math.round(lum * (px[i + 3] / 255));
  }
  mg.putImageData(d, 0, 0);
  craftMaskCache.set(img, m);
  return m;
}

// Dibuja una capa en un canvas 2D (exportación PDF y horneado 3D comparten esta función)
export function drawLayer(ctx, l, sc, fill, clipPts) {
  ctx.save();
  if (clipPts && clipPts.length > 2) {
    ctx.beginPath();
    clipPts.forEach((p, i) => i ? ctx.lineTo(p[0] * sc, p[1] * sc) : ctx.moveTo(p[0] * sc, p[1] * sc));
    ctx.closePath(); ctx.clip();
  }
  ctx.globalAlpha = l.opacity == null ? 1 : l.opacity;
  if (!fill && l.blend && l.blend !== 'normal') ctx.globalCompositeOperation = l.blend; // los canales de acabado son máscaras: sin mezcla
  if (l.rot || l.flipX || l.flipY) {
    const b = bboxOf(l), rcx = (b[0] + b[2] / 2) * sc, rcy = (b[1] + b[3] / 2) * sc;
    ctx.translate(rcx, rcy);
    if (l.rot) ctx.rotate(l.rot * Math.PI / 180);
    if (l.flipX || l.flipY) ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
    ctx.translate(-rcx, -rcy);
  }
  const finishColor = l.finish === 'foil' ? '#C9A227' : l.finish === 'silver' ? '#B8BAC4' : null;
  if (l.kind === 'text') {
    const sx = l.scaleX == null ? 1 : l.scaleX, sy = l.scaleY == null ? 1 : l.scaleY, m = textMetrics(l);
    if (sx !== 1 || sy !== 1) {
      const b = bboxOf(l), cx = (b[0] + b[2] / 2) * sc, cy = (b[1] + b[3] / 2) * sc;
      ctx.translate(cx, cy); ctx.scale(sx, sy); ctx.translate(-cx, -cy);
    }
    ctx.font = (l.italic ? 'italic ' : '') + (l.weight || 400) + ' ' + (l.size * sc) + 'px "' + (l.font || 'Noto Sans') + '"';
    ctx.textAlign = l.align === 'left' ? 'left' : l.align === 'right' ? 'right' : 'center'; ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (l.letterSpacing || 0) * sc + 'px';
    const emb = !fill && l.finish === 'emboss';
    if (fill) ctx.fillStyle = fill;
    else if (emb) { ctx.strokeStyle = '#b8b0a0'; ctx.lineWidth = sc * 0.15; }
    else ctx.fillStyle = finishColor || l.color || '#211d18';
    m.lines.forEach((ln, i) => { const yy = (l.y + i * l.size * m.lh) * sc; if (emb) ctx.strokeText(ln, m.ax * sc, yy); else ctx.fillText(ln, m.ax * sc, yy); });
  } else if (l.kind === 'shape') {
    const p = new Path2D(shapePathD(l)), line = l.shape === 'line', sw = line ? (l.strokeW == null ? 0.8 : l.strokeW) : (l.strokeW || 0);
    ctx.save(); ctx.scale(sc, sc);
    if (!line && l.fillOn !== false) { ctx.fillStyle = fill || (l.finish === 'emboss' ? 'rgba(33,29,24,0.12)' : finishColor || l.color || '#211d18'); ctx.fill(p); }
    if (sw > 0) { ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = fill || finishColor || (line ? l.stroke || l.color : l.stroke) || '#211d18'; ctx.stroke(p); }
    ctx.restore();
  } else if (l.img) {
    const cr = l.crop || [0, 0, 1, 1];
    const iw = l.img.naturalWidth, ih = l.img.naturalHeight;
    const sx = cr[0] * iw, sy = cr[1] * ih, sw = cr[2] * iw, sh = cr[3] * ih;
    const dx = l.x * sc, dy = l.y * sc, dw = l.w * sc, dh = l.h * sc;
    if (fill || (l.finish && l.finish !== 'none')) {
      const t = document.createElement('canvas');
      t.width = Math.max(1, Math.ceil(dw)); t.height = Math.max(1, Math.ceil(dh));
      const tg = t.getContext('2d');
      tg.fillStyle = fill || (l.finish === 'foil' ? '#C9A227' : l.finish === 'silver' ? '#B8BAC4'
        : l.finish === 'uv' ? 'rgba(33,29,24,0.08)' : 'rgba(33,29,24,0.12)');
      tg.fillRect(0, 0, t.width, t.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(craftMaskOf(l.img), sx, sy, sw, sh, 0, 0, t.width, t.height);
      ctx.drawImage(t, dx, dy, dw, dh);
    } else {
      ctx.drawImage(l.img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  } else if (fill) {
    ctx.fillStyle = fill; ctx.fillRect(l.x * sc, l.y * sc, l.w * sc, l.h * sc);
  } else {
    ctx.strokeStyle = fill || '#b3a88f'; ctx.lineWidth = fill ? 2 : sc * 0.3;
    if (!fill) ctx.setLineDash([sc * 2, sc * 1.4]);
    ctx.strokeRect(l.x * sc, l.y * sc, l.w * sc, l.h * sc); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(l.x * sc, l.y * sc); ctx.lineTo((l.x + l.w) * sc, (l.y + l.h) * sc);
    ctx.moveTo((l.x + l.w) * sc, l.y * sc); ctx.lineTo(l.x * sc, (l.y + l.h) * sc);
    ctx.lineWidth = fill ? 2 : sc * 0.2; ctx.stroke();
    if (!fill) { ctx.font = '500 ' + (3.4 * sc) + 'px "Noto Sans"'; ctx.textAlign = 'center'; ctx.fillStyle = '#8a8071'; ctx.fillText(l.content || '', (l.x + l.w / 2) * sc, (l.y + l.h / 2) * sc); }
  }
  ctx.restore();
}
